// Build-time data collection.
//   node scripts/fetch.ts find-channel <query>          list official-channel candidates (prints only)
//   node scripts/fetch.ts fetch --collection <id> | --all [--force]
//   node scripts/fetch.ts draft-groups --collection <id> --ranges 1-15,16-30 [--pattern <regex>]
//     drafts groups (video ID lists) from the channel uploads by episode number, for a parent to review
// Any API failure aborts before writing, so a broken run never replaces good data (SPEC §7, F3).

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateCollection,
  type CollectionConfig,
  type CollectionData,
  type CollectionGroup,
  type UploadsSource,
  type VideoRecord,
} from '../src/config.ts';
import { createClient, type PlaylistEntry, type VideoDetails, type YouTubeClient } from './youtube.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_DIR = join(ROOT, 'config', 'collections');
const DATA_DIR = join(ROOT, 'data', 'collections');

/** Shorts can now run up to 3 minutes. */
export const SHORTS_MAX_SEC = 180;
/** A group shrinking by more than this fraction needs --force. */
export const MAX_DROP = 0.5;

type Log = (msg: string) => void;

export function buildDisplayTitle(title: string, stripPatterns: string[]): string {
  let out = title;
  for (const p of stripPatterns) out = out.replace(new RegExp(p, 'u'), '');
  out = out.trim();
  return out || title.trim();
}

/** Keep playlist order, drop everything the whitelist and filters reject. */
export function selectVideos(
  config: CollectionConfig,
  group: CollectionGroup,
  entries: PlaylistEntry[],
  details: Map<string, VideoDetails>,
  log: Log,
): VideoRecord[] {
  const channels = new Set(config.channels);
  const exclude = config.titleExcludePatterns.map((p) => new RegExp(p, 'u'));
  const seen = new Set<string>();
  const out: VideoRecord[] = [];

  for (const { videoId } of entries) {
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    const v = details.get(videoId);
    const at = `[${config.id}/${group.id}] ${videoId}`;
    if (!v) {
      log(`${at}: removed (deleted or private)`);
      continue;
    }
    if (!channels.has(v.channelId)) {
      log(`WARNING ${at}: channel ${v.channelId} is not whitelisted, skipped ("${v.title}")`);
      continue;
    }
    if (v.privacyStatus === 'private') {
      log(`${at}: private, skipped`);
      continue;
    }
    if (!v.embeddable) {
      log(`${at}: embedding disabled, skipped`);
      continue;
    }
    if (config.excludeShorts && v.durationSec <= SHORTS_MAX_SEC) {
      log(`WARNING ${at}: ${v.durationSec}s is treated as a Short, skipped ("${v.title}")`);
      continue;
    }
    if (exclude.some((re) => re.test(v.title))) {
      log(`${at}: title matches titleExcludePatterns, skipped`);
      continue;
    }
    out.push({
      id: v.id,
      title: v.title,
      displayTitle: buildDisplayTitle(v.title, config.titleStripPatterns),
      durationSec: v.durationSec,
      channelId: v.channelId,
      group: group.id,
      order: out.length + 1,
      ...(v.hasCaptions ? { hasCaptions: true } : {}),
    });
  }
  return out;
}

/** F3: refuse empty groups and large drops unless forced. First run (no previous data) skips the comparison. */
export function checkSafety(prev: CollectionData | null, next: CollectionData, force: boolean): string[] {
  if (force) return [];
  const problems: string[] = [];
  const prevCounts = new Map(prev?.groups.map((g) => [g.id, g.videos.length]) ?? []);
  for (const g of next.groups) {
    if (g.videos.length === 0) {
      problems.push(`group "${g.id}" has 0 videos`);
      continue;
    }
    const before = prevCounts.get(g.id);
    if (before !== undefined && before > 0 && g.videos.length < before * (1 - MAX_DROP)) {
      problems.push(`group "${g.id}" dropped from ${before} to ${g.videos.length} videos`);
    }
  }
  return problems;
}

/**
 * `uploads` groups: channel uploads (newest first) matching the duration window and title pattern,
 * cut to the newest N. Embedding and whitelist checks still happen in selectVideos.
 */
export function selectUploads(
  uploads: PlaylistEntry[],
  details: Map<string, VideoDetails>,
  rule: UploadsSource,
): PlaylistEntry[] {
  const title = rule.titlePattern ? new RegExp(rule.titlePattern, 'u') : null;
  const matches = uploads.filter(({ videoId }) => {
    const v = details.get(videoId);
    if (!v || !v.embeddable) return false;
    if (rule.minSec !== undefined && v.durationSec < rule.minSec) return false;
    if (rule.maxSec !== undefined && v.durationSec > rule.maxSec) return false;
    return !title || title.test(v.title);
  });
  return (rule.latest ? matches.slice(0, rule.latest) : matches).map((e, position) => ({ videoId: e.videoId, position }));
}

export async function collect(
  client: YouTubeClient,
  config: CollectionConfig,
  now: Date,
  log: Log,
): Promise<CollectionData> {
  const groups: CollectionData['groups'] = [];
  // Channel uploads are read once per collection and shared by every `uploads` group.
  let uploads: { entries: PlaylistEntry[]; details: Map<string, VideoDetails> } | null = null;
  const channelUploads = async () => {
    if (uploads) return uploads;
    const entries: PlaylistEntry[] = [];
    for (const channel of config.channels) entries.push(...(await client.playlistItems(`UU${channel.slice(2)}`)));
    const details = new Map((await client.videos([...new Set(entries.map((e) => e.videoId))])).map((v) => [v.id, v]));
    uploads = { entries, details };
    return uploads;
  };

  for (const group of config.groups) {
    let entries: PlaylistEntry[];
    let details: Map<string, VideoDetails>;
    if (group.uploads) {
      const u = await channelUploads();
      entries = selectUploads(u.entries, u.details, group.uploads);
      details = u.details;
    } else {
      entries = group.videos
        ? group.videos.map((videoId, position) => ({ videoId, position }))
        : await client.playlistItems(group.playlistId!);
      details = new Map((await client.videos([...new Set(entries.map((e) => e.videoId))])).map((v) => [v.id, v]));
    }
    const videos = selectVideos(config, group, entries, details, log);
    log(`[${config.id}/${group.id}] ${videos.length} of ${entries.length} playlist items kept`);
    groups.push({ id: group.id, videos });
  }
  return { collectionId: config.id, fetchedAt: now.toISOString(), groups };
}

export interface DraftPick {
  n: number;
  id: string;
  title: string;
  /** Other uploads with the same episode number, for the parent to swap in. */
  alternatives: { id: string; title: string }[];
}

export interface DraftGroup {
  id: string;
  label: string;
  videos: string[];
  picks: DraftPick[];
  missing: number[];
}

/** Episode-length window used when drafting: longer than a Short, shorter than a compilation. */
export const DRAFT_MAX_SEC = 1800;

/**
 * Draft groups from a channel's uploads by the episode number the title pattern captures.
 * Only a starting point for a parent to review; nothing here is written to config.
 * `uploads` is in channel upload order (newest first); the newest upload of each number wins.
 */
export function draftGroups(uploads: VideoDetails[], ranges: [number, number][], pattern: RegExp): DraftGroup[] {
  const byNumber = new Map<number, VideoDetails[]>();
  for (const v of uploads) {
    if (!v.embeddable || v.durationSec <= SHORTS_MAX_SEC || v.durationSec > DRAFT_MAX_SEC) continue;
    const n = Number(pattern.exec(v.title)?.[1]);
    if (!Number.isInteger(n)) continue;
    byNumber.set(n, [...(byNumber.get(n) ?? []), v]);
  }
  return ranges.map(([from, to], i) => {
    const picks: DraftPick[] = [];
    const missing: number[] = [];
    for (let n = from; n <= to; n++) {
      const [first, ...rest] = byNumber.get(n) ?? [];
      if (!first) missing.push(n);
      else picks.push({ n, id: first.id, title: first.title, alternatives: rest.map((v) => ({ id: v.id, title: v.title })) });
    }
    return { id: `lv${i + 1}`, label: `${i + 1}단계`, videos: picks.map((p) => p.id), picks, missing };
  });
}

export function parseRanges(spec: string): [number, number][] {
  const ranges = spec.split(',').map((part) => {
    const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(part);
    if (!m || Number(m[1]) > Number(m[2])) throw new Error(`invalid range "${part}" (use e.g. 1-15,16-30)`);
    return [Number(m[1]), Number(m[2])] as [number, number];
  });
  if (ranges.length === 0) throw new Error('at least one range is required');
  return ranges;
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function loadCollection(id: string): Promise<CollectionConfig> {
  const raw = await readJson(join(CONFIG_DIR, `${id}.json`));
  if (raw === null) throw new Error(`config/collections/${id}.json not found`);
  const res = validateCollection(raw, id);
  if (!res.ok) throw new Error(`config/collections/${id}.json is invalid:\n  - ${res.errors.join('\n  - ')}`);
  return res.value;
}

async function listCollectionIds(): Promise<string[]> {
  const files = await readdir(CONFIG_DIR);
  return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)).sort();
}

const VALUE_FLAGS = new Set(['--collection', '--ranges', '--pattern', '--channel']);

function parseArgs(argv: string[]): { command: string; rest: string[]; flags: Map<string, string | true> } {
  const [command = '', ...args] = argv;
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const next = args[i + 1];
      if (VALUE_FLAGS.has(a) && next !== undefined) {
        flags.set(a, next);
        i++;
      } else flags.set(a, true);
    } else rest.push(a);
  }
  return { command, rest, flags };
}

async function findChannel(client: YouTubeClient, query: string): Promise<void> {
  if (!query) throw new Error('usage: npm run find-channel -- "<search words>"');
  const candidates = await client.searchChannels(query);
  if (candidates.length === 0) {
    console.log(`No channels found for "${query}".`);
    return;
  }
  console.log(`Channel candidates for "${query}" (verify the official one before adding it to config):\n`);
  candidates.forEach((c, i) => {
    const subs = c.subscriberCount === null ? 'hidden' : c.subscriberCount.toLocaleString('ko-KR');
    console.log(`${i + 1}. ${c.title}  ${c.customUrl ?? ''}`);
    console.log(`   id: ${c.id}`);
    console.log(`   subscribers: ${subs}, videos: ${c.videoCount ?? '?'}`);
    console.log(`   https://www.youtube.com/channel/${c.id}`);
    const desc = c.description.replace(/\s+/g, ' ').trim();
    if (desc) console.log(`   ${desc.slice(0, 120)}${desc.length > 120 ? '…' : ''}`);
    console.log('');
  });
}

/** Overview of a confirmed channel for designing groups: its playlists and how its uploads split by length. */
async function scoutCommand(client: YouTubeClient, flags: Map<string, string | true>): Promise<void> {
  const channel = flags.get('--channel');
  if (typeof channel !== 'string' || !channel.startsWith('UC')) throw new Error('usage: npm run scout -- --channel <UC... channel id>');

  const playlists = (await client.channelPlaylists(channel)).sort((a, b) => b.itemCount - a.itemCount);
  console.log(`Playlists (${playlists.length}), biggest first:`);
  for (const p of playlists) console.log(`  ${String(p.itemCount).padStart(4)}  ${p.id}  ${p.title}`);

  const entries = await client.playlistItems(`UU${channel.slice(2)}`);
  const uploads = await client.videos(entries.map((e) => e.videoId));
  const playable = uploads.filter((v) => v.embeddable && v.privacyStatus === 'public');
  const bucket = (min: number, max: number) => playable.filter((v) => v.durationSec >= min && v.durationSec < max).length;
  console.log(`\nUploads: ${uploads.length} total, ${playable.length} public and embeddable`);
  console.log(`  shorts (<= 60s): ${bucket(0, 61)}`);
  console.log(`  1-15 min:       ${bucket(61, 901)}`);
  console.log(`  15-30 min:      ${bucket(901, 1800)}`);
  console.log(`  30 min+:        ${bucket(1800, Infinity)}`);
  console.log('\nNewest 15 uploads:');
  for (const v of uploads.slice(0, 15)) {
    const flag = v.embeddable && v.privacyStatus === 'public' ? '' : `  [${v.embeddable ? v.privacyStatus : 'not embeddable'}]`;
    console.log(`  ${String(Math.round(v.durationSec / 60)).padStart(3)}m  ${v.id}  ${v.title}${flag}`);
  }
}

async function fetchCommand(client: YouTubeClient, flags: Map<string, string | true>): Promise<void> {
  const force = flags.has('--force');
  const one = flags.get('--collection');
  let ids: string[];
  if (typeof one === 'string') ids = [one];
  else if (flags.has('--all')) ids = await listCollectionIds();
  else throw new Error('usage: npm run fetch -- --collection <id> | --all [--force]');

  // Validate everything first, collect everything second, write only when all collections passed.
  const configs: CollectionConfig[] = [];
  for (const id of ids) {
    const config = await loadCollection(id);
    if (config.enabled) configs.push(config);
    else console.log(`[${id}] disabled, skipped`);
  }

  const now = new Date();
  const results: CollectionData[] = [];
  const problems: string[] = [];
  for (const config of configs) {
    const data = await collect(client, config, now, console.log);
    const prev = (await readJson(join(DATA_DIR, config.id, 'videos.json'))) as CollectionData | null;
    problems.push(...checkSafety(prev, data, force).map((p) => `[${config.id}] ${p}`));
    results.push(data);
  }
  if (problems.length) {
    throw new Error(`Refusing to write (re-run with --force if intended):\n  - ${problems.join('\n  - ')}`);
  }

  for (const data of results) {
    const dir = join(DATA_DIR, data.collectionId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'videos.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    const total = data.groups.reduce((n, g) => n + g.videos.length, 0);
    console.log(`[${data.collectionId}] wrote ${total} videos to data/collections/${data.collectionId}/videos.json`);
  }
}

async function draftCommand(client: YouTubeClient, flags: Map<string, string | true>): Promise<void> {
  const id = flags.get('--collection');
  const rangesSpec = flags.get('--ranges');
  if (typeof id !== 'string' || typeof rangesSpec !== 'string') {
    throw new Error('usage: npm run draft-groups -- --collection <id> --ranges 1-15,16-30 [--pattern "<regex with one number group>"]');
  }
  const ranges = parseRanges(rangesSpec);
  const patternFlag = flags.get('--pattern');
  const pattern = new RegExp(typeof patternFlag === 'string' ? patternFlag : '^(\\d+)[.\\s]', 'u');

  // Only the channel whitelist is needed here; groups may still be empty while drafting.
  const raw = (await readJson(join(CONFIG_DIR, `${id}.json`))) as { channels?: unknown } | null;
  const channels = Array.isArray(raw?.channels) ? raw.channels.filter((c): c is string => typeof c === 'string' && c !== '') : [];
  if (channels.length === 0) throw new Error(`config/collections/${id}.json has no confirmed channels yet`);

  const uploads: VideoDetails[] = [];
  for (const channel of channels) {
    // A channel's uploads playlist is its ID with the UC prefix replaced by UU.
    const entries = await client.playlistItems(`UU${channel.slice(2)}`);
    uploads.push(...(await client.videos(entries.map((e) => e.videoId))));
  }
  const groups = draftGroups(uploads, ranges, pattern);

  const dir = join(DATA_DIR, id);
  await mkdir(dir, { recursive: true });
  const out = join(dir, 'draft-groups.json');
  await writeFile(out, `${JSON.stringify({ pattern: pattern.source, groups }, null, 2)}\n`, 'utf8');

  for (const g of groups) {
    const dupes = g.picks.filter((p) => p.alternatives.length).map((p) => p.n);
    console.log(`${g.id} (${g.label}): ${g.videos.length} videos` +
      (g.missing.length ? `, missing #${g.missing.join(', #')}` : '') +
      (dupes.length ? `, duplicates for #${dupes.join(', #')} (newest picked)` : ''));
    for (const p of g.picks) console.log(`   ${String(p.n).padStart(3)}  ${p.id}  ${p.title}`);
  }
  console.log(`\nDraft written to data/collections/${id}/draft-groups.json. Review it, then copy the groups you approve into config.`);
}

async function main(): Promise<void> {
  const { command, rest, flags } = parseArgs(process.argv.slice(2));
  if (!['find-channel', 'scout', 'fetch', 'draft-groups'].includes(command)) {
    throw new Error(
      'usage: node scripts/fetch.ts find-channel <query> | scout --channel <id> | fetch --collection <id> | --all [--force] | draft-groups --collection <id> --ranges 1-15',
    );
  }
  const client = createClient(process.env.YOUTUBE_API_KEY ?? '');
  if (command === 'find-channel') await findChannel(client, rest.join(' '));
  else if (command === 'scout') await scoutCommand(client, flags);
  else if (command === 'draft-groups') await draftCommand(client, flags);
  else await fetchCommand(client, flags);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
