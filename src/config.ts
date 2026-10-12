// Config types and validation shared by the app and the build-time scripts.
// Validators return every problem at once so a parent editing JSON by hand sees all of them.

/** Uploads of the whitelisted channels, filtered at fetch time; newest first. Refreshes itself every fetch. */
export interface UploadsSource {
  /** Minimum duration in seconds (inclusive). */
  minSec?: number;
  /** Maximum duration in seconds (inclusive). */
  maxSec?: number;
  /** Keep only the newest N matches. */
  latest?: number;
  /** Keep only titles matching this regular expression. */
  titlePattern?: string;
}

/**
 * A group's videos come from exactly one source: a YouTube playlist, an explicit list of video IDs, or the
 * channels' uploads filtered by rules. Parents cannot save made-for-kids videos to their own playlists, so
 * kids' collections use `videos`, official channel playlists, or `uploads`.
 *
 * `kind`: "series" groups are watched in order and drive "today's video" and the ✔ progression;
 * "free" groups (compilations, clips) are picked freely and never suggested as the next episode.
 */
export interface CollectionGroup {
  id: string;
  label: string;
  kind?: 'series' | 'free';
  playlistId?: string;
  /** Video IDs in viewing order. */
  videos?: string[];
  uploads?: UploadsSource;
}

export function groupKind(g: Pick<CollectionGroup, 'kind'>): 'series' | 'free' {
  return g.kind ?? 'series';
}

export interface CollectionConfig {
  id: string;
  displayName: string;
  enabled: boolean;
  channels: string[];
  coverVideoId: string | null;
  groupLabel: string;
  groups: CollectionGroup[];
  excludeShorts: boolean;
  titleExcludePatterns: string[];
  titleStripPatterns: string[];
}

export interface Profile {
  id: string;
  name: string;
  color: string;
  collections: string[];
  startGroup?: Record<string, string>;
  dailyEpisodes: number | null;
  dailyMinutes: number | null;
}

export interface ProfilesConfig {
  profiles: Profile[];
}

export interface VideoRecord {
  id: string;
  title: string;
  displayTitle: string;
  durationSec: number;
  channelId: string;
  group: string;
  /** 1-based position inside its group (playlist order). */
  order: number;
}

export interface CollectionData {
  collectionId: string;
  fetchedAt: string;
  groups: { id: string; videos: VideoRecord[] }[];
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const ID_RE = /^[a-z0-9-]+$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function checkPatterns(field: string, v: unknown, errors: string[]): void {
  if (!isStrArray(v)) {
    errors.push(`${field} must be an array of strings`);
    return;
  }
  for (const p of v) {
    try {
      new RegExp(p);
    } catch {
      errors.push(`${field} has an invalid regular expression: ${p}`);
    }
  }
}

function isLimit(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0);
}

export function validateCollection(raw: unknown, fileId?: string): Validated<CollectionConfig> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['collection config must be a JSON object'] };

  const id = raw.id;
  if (!isStr(id) || !ID_RE.test(id)) errors.push('id must match ^[a-z0-9-]+$');
  else if (fileId !== undefined && id !== fileId) errors.push(`id "${id}" does not match file name "${fileId}"`);
  if (!isStr(raw.displayName)) errors.push('displayName is required');
  if (typeof raw.enabled !== 'boolean') errors.push('enabled must be true or false');
  if (!isStrArray(raw.channels) || raw.channels.length === 0 || raw.channels.some((c) => !isStr(c))) {
    errors.push('channels must list at least one confirmed official channel ID (run find-channel first)');
  }
  if (raw.coverVideoId !== null && !isStr(raw.coverVideoId)) errors.push('coverVideoId must be a video ID or null');
  if (!isStr(raw.groupLabel)) errors.push('groupLabel is required');
  if (typeof raw.excludeShorts !== 'boolean') errors.push('excludeShorts must be true or false');
  checkPatterns('titleExcludePatterns', raw.titleExcludePatterns, errors);
  checkPatterns('titleStripPatterns', raw.titleStripPatterns, errors);

  if (!Array.isArray(raw.groups) || raw.groups.length === 0) {
    errors.push('groups must have at least one group');
  } else {
    const seen = new Set<string>();
    raw.groups.forEach((g, i) => {
      if (!isObj(g)) {
        errors.push(`groups[${i}] must be an object`);
        return;
      }
      if (!isStr(g.id) || !ID_RE.test(g.id)) errors.push(`groups[${i}].id must match ^[a-z0-9-]+$`);
      else if (seen.has(g.id)) errors.push(`groups[${i}].id "${g.id}" is duplicated`);
      else seen.add(g.id);
      if (!isStr(g.label)) errors.push(`groups[${i}].label is required`);
      if (g.kind !== undefined && g.kind !== 'series' && g.kind !== 'free') {
        errors.push(`groups[${i}].kind must be "series" or "free"`);
      }
      const sources = ['playlistId', 'videos', 'uploads'].filter((k) => k in g);
      if (sources.length !== 1) {
        errors.push(`groups[${i}] needs exactly one of playlistId, videos or uploads`);
      } else if ('playlistId' in g && !isStr(g.playlistId)) {
        errors.push(`groups[${i}].playlistId must be a non-empty playlist ID`);
      } else if ('videos' in g && (!isStrArray(g.videos) || g.videos.length === 0 || g.videos.some((v) => !isStr(v)))) {
        errors.push(`groups[${i}].videos must be a non-empty array of video IDs`);
      } else if ('uploads' in g) {
        const u = g.uploads;
        if (!isObj(u)) errors.push(`groups[${i}].uploads must be an object`);
        else {
          for (const k of ['minSec', 'maxSec', 'latest'] as const) {
            if (u[k] !== undefined && !(typeof u[k] === 'number' && Number.isInteger(u[k]) && (u[k] as number) > 0)) {
              errors.push(`groups[${i}].uploads.${k} must be a positive integer`);
            }
          }
          if (u.titlePattern !== undefined) checkPatterns(`groups[${i}].uploads.titlePattern`, [u.titlePattern], errors);
        }
      }
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: raw as unknown as CollectionConfig };
}

/** `collectionGroups` maps each known collection ID to its group IDs. */
export function validateProfiles(
  raw: unknown,
  collectionGroups: Record<string, string[]>,
): Validated<ProfilesConfig> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['profiles config must be a JSON object'] };
  if ('prereq' in raw) errors.push('prereq is a v1.1 feature and is not supported in v1');
  if (!Array.isArray(raw.profiles) || raw.profiles.length === 0) {
    errors.push('profiles must have at least one profile');
    return { ok: false, errors };
  }

  const seen = new Set<string>();
  raw.profiles.forEach((p, i) => {
    const at = `profiles[${i}]`;
    if (!isObj(p)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if ('prereq' in p) errors.push(`${at}.prereq is a v1.1 feature and is not supported in v1`);
    if (!isStr(p.id) || !ID_RE.test(p.id)) errors.push(`${at}.id must match ^[a-z0-9-]+$`);
    else if (seen.has(p.id)) errors.push(`${at}.id "${p.id}" is duplicated`);
    else seen.add(p.id);
    if (!isStr(p.name)) errors.push(`${at}.name is required (use a nickname, not a real name)`);
    if (typeof p.color !== 'string' || !COLOR_RE.test(p.color)) errors.push(`${at}.color must be #RRGGBB`);
    if (!isLimit(p.dailyEpisodes)) errors.push(`${at}.dailyEpisodes must be a non-negative integer or null`);
    if (!isLimit(p.dailyMinutes)) errors.push(`${at}.dailyMinutes must be a non-negative integer or null`);

    if (!isStrArray(p.collections) || p.collections.length === 0) {
      errors.push(`${at}.collections must list at least one collection`);
    } else {
      for (const c of p.collections) {
        if (!(c in collectionGroups)) errors.push(`${at}.collections references unknown collection "${c}"`);
      }
    }

    if (p.startGroup !== undefined) {
      if (!isObj(p.startGroup)) {
        errors.push(`${at}.startGroup must be an object of collectionId -> groupId`);
      } else {
        for (const [c, g] of Object.entries(p.startGroup)) {
          const groups = collectionGroups[c];
          if (!groups) errors.push(`${at}.startGroup references unknown collection "${c}"`);
          else if (typeof g !== 'string' || !groups.includes(g)) {
            errors.push(`${at}.startGroup.${c} references unknown group "${String(g)}"`);
          }
        }
      }
    }
  });

  return errors.length ? { ok: false, errors } : { ok: true, value: raw as unknown as ProfilesConfig };
}
