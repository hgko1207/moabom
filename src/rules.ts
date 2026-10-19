// Pure viewing rules (SPEC §8). No DOM, no storage: everything is passed in so it can be unit-tested.

import { groupKind, type CollectionConfig, type CollectionData, type Profile, type VideoRecord } from './config.ts';
import type { CollectionProgress, DeviceSettings, DeviceToday, History, TodayState } from './storage.ts';

export const STALE_DAYS = 30;
/** L1: seconds of playback today before a video counts toward the daily episode limit. */
export const COUNT_AFTER_SEC = 10;
/** O1: fraction of the duration that must actually be played to mark a video watched. */
export const WATCHED_FRACTION = 0.9;
/** P3: the up-next card appears when this many seconds remain. */
export const UP_NEXT_SEC = 20;
/** Videos longer than this (compilations) stop at the daily limit instead of playing to the end. */
export const LONG_VIDEO_SEC = 900;

/** Device-local calendar date (YYYY-MM-DD); the daily limit resets at local midnight. */
export function localDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** A YYYY-MM-DD date moved by whole days (calendar arithmetic, no time zone involved). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

// ---------- viewing history (H) ----------

export const HISTORY_DAYS = 30;

/** H1: add played seconds for a video on a day; days older than HISTORY_DAYS are dropped. */
export function recordHistory(h: History, date: string, collectionId: string, videoId: string, sec: number): History {
  const day = h[date] ?? { seconds: 0, videos: {} };
  const entry = day.videos[videoId] ?? { c: collectionId, sec: 0 };
  const next: History = {
    ...h,
    [date]: { seconds: day.seconds + sec, videos: { ...day.videos, [videoId]: { ...entry, sec: entry.sec + sec } } },
  };
  const oldest = shiftDate(date, -(HISTORY_DAYS - 1));
  for (const d of Object.keys(next)) if (d < oldest) delete next[d];
  return next;
}

/** H2: mark a video finished on a day (only if it was played that day). */
export function recordHistoryDone(h: History, date: string, videoId: string): History {
  const day = h[date];
  const entry = day?.videos[videoId];
  if (!day || !entry || entry.done) return h;
  return { ...h, [date]: { ...day, videos: { ...day.videos, [videoId]: { ...entry, done: true } } } };
}

/**
 * H4: fill today's history from today's limit counters, which have been kept longer. Playback before the history
 * log existed, or on an app still running older code, shows up in 설정 → 오늘 but not in the log; this makes the log
 * never show less than that. Back-filled videos go first (they were watched before the logged ones).
 */
export function withToday(h: History, today: TodayState, collectionOf: (videoId: string) => string | null): History {
  const day = h[today.date] ?? { seconds: 0, videos: {} };
  const added: History[string]['videos'] = {};
  const videos = { ...day.videos };
  for (const [id, sec] of Object.entries(today.playedToday)) {
    const e = videos[id];
    if (e) {
      if (sec > e.sec) videos[id] = { ...e, sec };
    } else {
      const c = collectionOf(id);
      if (c) added[id] = { c, sec };
    }
  }
  const merged = { ...added, ...videos };
  for (const id of today.finished) if (merged[id] && !merged[id].done) merged[id] = { ...merged[id], done: true };
  const seconds = Math.max(day.seconds, today.seconds);
  const unchanged = seconds === day.seconds && JSON.stringify(merged) === JSON.stringify(day.videos);
  return unchanged ? h : { ...h, [today.date]: { seconds, videos: merged } };
}

/** The last `n` dates ending today, newest first, with that day's log (empty when nothing was watched). */
export function recentDays(h: History, today: string, n: number): { date: string; seconds: number; videos: [string, History[string]['videos'][string]][] }[] {
  return Array.from({ length: n }, (_, i) => {
    const date = shiftDate(today, -i);
    const day = h[date];
    return { date, seconds: day?.seconds ?? 0, videos: day ? Object.entries(day.videos).reverse() : [] };
  });
}

export function isStale(fetchedAt: string, now: Date): boolean {
  const t = Date.parse(fetchedAt);
  return Number.isNaN(t) || now.getTime() - t > STALE_DAYS * 86_400_000;
}

/** All videos in viewing order: group order, then position inside the group. */
export function viewingOrder(data: CollectionData): VideoRecord[] {
  return data.groups.flatMap((g) => g.videos);
}

/**
 * O3: the first unwatched video from the start group onwards, wrapping to the first group,
 * skipping videos that failed to play on this device. Null when everything is watched.
 */
export function nextToWatch(data: CollectionData, p: CollectionProgress, startGroup?: string): VideoRecord | null {
  const all = viewingOrder(data);
  const start = Math.max(0, all.findIndex((v) => v.group === startGroup));
  const rotated = [...all.slice(start), ...all.slice(0, start)];
  return rotated.find((v) => !(v.id in p.watched) && !(v.id in p.failed)) ?? null;
}

/**
 * When a collection was last played. Progress saved before `lastAt` existed (before 2026-10-16) falls back to its
 * newest finish time, and a collection that was only started gets a token 1 so it still counts as played.
 */
export function progressRecency(p: Pick<CollectionProgress, 'watched' | 'last' | 'lastAt'>): number {
  if (p.lastAt) return p.lastAt;
  const finished = Math.max(0, ...Object.values(p.watched));
  return finished || (p.last ? 1 : 0);
}

/** The collection played most recently (for the home screen's 이어 보기), or null if none was played yet. */
export function mostRecentCollection(entries: { id: string; lastAt?: number }[]): string | null {
  let best: { id: string; lastAt: number } | null = null;
  for (const e of entries) if ((e.lastAt ?? 0) > (best?.lastAt ?? 0)) best = { id: e.id, lastAt: e.lastAt! };
  return best?.id ?? null;
}

export interface HeroPick {
  video: VideoRecord;
  /** True when it continues from a saved position ("이어 보기"). */
  resume: boolean;
}

/**
 * O3b: what the collection screen offers first.
 * 1. The video the kids were last in the middle of, in any group (a compilation too), from where they stopped.
 * 2. After finishing a series episode, the next unwatched one after it (not an earlier skipped one).
 * 3. Otherwise O3's next to watch.
 */
export function heroPick(
  data: CollectionData,
  config: Pick<CollectionConfig, 'groups'>,
  p: CollectionProgress,
  startGroup?: string,
): HeroPick | null {
  const open = (v: VideoRecord) => !(v.id in p.watched) && !(v.id in p.failed);
  const last = p.last ? viewingOrder(data).find((v) => v.id === p.last) : undefined;
  if (last && open(last) && startPosition(p, last) > 0) return { video: last, resume: true };

  const series = seriesOnly(data, config);
  if (last && last.id in p.watched) {
    const order = viewingOrder(series);
    const i = order.findIndex((v) => v.id === last.id);
    const after = i < 0 ? undefined : [...order.slice(i + 1), ...order.slice(0, i)].find(open);
    if (after) return { video: after, resume: startPosition(p, after) > 0 };
  }
  const next = nextToWatch(series, p, startGroup);
  return next ? { video: next, resume: startPosition(p, next) > 0 } : null;
}

/** O3a: the tab to open first. */
export function initialGroup(data: CollectionData, p: CollectionProgress, startGroup?: string): string | null {
  const next = nextToWatch(data, p, startGroup);
  if (next) return next.group;
  const last = p.last ? viewingOrder(data).find((v) => v.id === p.last) : undefined;
  if (last) return last.group;
  const start = data.groups.find((g) => g.id === startGroup);
  return start?.id ?? data.groups[0]?.id ?? null;
}

// ---------- daily limit (L) ----------

export type Limits = Pick<Profile, 'dailyEpisodes' | 'dailyMinutes'>;

/** Device settings saved by a parent override the profile defaults from config. */
export function effectiveLimits(profile: Limits, settings: DeviceSettings | null): Limits {
  if (!settings) return { dailyEpisodes: profile.dailyEpisodes, dailyMinutes: profile.dailyMinutes };
  const { mode, value } = settings.limit;
  if (mode === 'minutes') return { dailyEpisodes: null, dailyMinutes: value };
  if (mode === 'episodes') return { dailyEpisodes: value, dailyMinutes: null };
  return { dailyEpisodes: null, dailyMinutes: null };
}

// ---------- device display settings ----------

/** Collections the kids see, in config order. Never empty: if every one is hidden, all are shown. */
export function visibleCollectionIds(ids: string[], settings: DeviceSettings | null): string[] {
  const hidden = new Set(settings?.hidden ?? []);
  const shown = ids.filter((id) => !hidden.has(id));
  return shown.length ? shown : ids;
}

/** Collections in the parent's order on this device; ones not ordered yet (e.g. newly added) keep config order at the end. */
export function orderCollectionIds(ids: string[], settings: DeviceSettings | null): string[] {
  const order = settings?.order ?? [];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i >= 0 ? i : order.length + ids.indexOf(id);
  };
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

/** Where a collection would go one step up (-1) or down (+1) inside its own category; -1 when it cannot move. */
function moveTarget(ordered: string[], id: string, step: -1 | 1, categoryOf: (id: string) => string): number {
  const from = ordered.indexOf(id);
  if (from < 0) return -1;
  for (let to = from + step; to >= 0 && to < ordered.length; to += step) {
    if (categoryOf(ordered[to]!) === categoryOf(id)) return to;
  }
  return -1;
}

/**
 * The new full order after moving one collection a step up (-1) or down (+1), swapping with its nearest
 * neighbour in the same category (the home screen shows one row per category, design DR14).
 */
export function moveCollection(ordered: string[], id: string, step: -1 | 1, categoryOf: (id: string) => string = () => ''): string[] {
  const from = ordered.indexOf(id);
  const to = moveTarget(ordered, id, step, categoryOf);
  if (to < 0) return ordered;
  const next = [...ordered];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function canMoveCollection(ordered: string[], id: string, step: -1 | 1, categoryOf: (id: string) => string = () => ''): boolean {
  return moveTarget(ordered, id, step, categoryOf) >= 0;
}

/**
 * Home rows (design P1-8): one per category in categories.json order, items in the given (parent) order,
 * categories with nothing to show left out.
 */
export function groupByCategory<T>(items: T[], categoryOf: (item: T) => string, categories: readonly { id: string }[]): { category: string; items: T[] }[] {
  return categories
    .map((c) => ({ category: c.id, items: items.filter((i) => categoryOf(i) === c.id) }))
    .filter((row) => row.items.length > 0);
}

export const TITLE_MAX = 12;

/** Home screen title: the parent's title on this device, else the profile name. */
export function homeTitle(profileName: string, settings: DeviceSettings | null): string {
  return settings?.title?.trim().slice(0, TITLE_MAX) || profileName;
}

/** L3: no new episode may start. Both limits null means unlimited. */
export function limitReached(today: TodayState, limits: Limits): boolean {
  if (limits.dailyEpisodes !== null && today.started.length >= limits.dailyEpisodes) return true;
  if (limits.dailyMinutes !== null && today.seconds >= limits.dailyMinutes * 60) return true;
  return false;
}

/** L3a: after the limit, only today's last started episode may reopen, and only while unfinished. */
export function resumableAfterLimit(today: TodayState): string | null {
  const last = today.started.at(-1);
  return last && !today.finished.includes(last) && !today.stopped.includes(last) ? last : null;
}

/** A long video playing past the limit is cut off (it continues tomorrow from the same spot). */
export function shouldCutAtLimit(today: TodayState, limits: Limits, video: Pick<VideoRecord, 'durationSec'>): boolean {
  return video.durationSec > LONG_VIDEO_SEC && limitReached(today, limits);
}

export function recordStopped(today: TodayState, videoId: string): TodayState {
  return today.stopped.includes(videoId) ? today : { ...today, stopped: [...today.stopped, videoId] };
}

export function canStart(today: TodayState, limits: Limits, videoId: string): boolean {
  if (!limitReached(today, limits)) return true;
  return resumableAfterLimit(today) === videoId;
}

/** L1/L2: add real playing time. A video counts as started once it reaches 10 s today. */
export function recordPlay(today: TodayState, videoId: string, sec: number): TodayState {
  const played = (today.playedToday[videoId] ?? 0) + sec;
  const counts = played >= COUNT_AFTER_SEC && !today.started.includes(videoId);
  return {
    ...today,
    seconds: today.seconds + sec,
    playedToday: { ...today.playedToday, [videoId]: played },
    started: counts ? [...today.started, videoId] : today.started,
  };
}

export function recordFinished(today: TodayState, videoId: string): TodayState {
  return today.finished.includes(videoId) ? today : { ...today, finished: [...today.finished, videoId] };
}

// ---------- progress (O1) ----------

/**
 * O1: accumulate played seconds; 90% of the duration marks the video watched and clears its progress.
 * Rewatching an already watched video records nothing (its completion time stays).
 */
export function recordProgress(
  p: CollectionProgress,
  video: Pick<VideoRecord, 'id' | 'durationSec'>,
  sec: number,
  now: number,
): { progress: CollectionProgress; completed: boolean } {
  if (video.id in p.watched) return { progress: { ...p, last: video.id, lastAt: now }, completed: false };
  const played = (p.progress[video.id] ?? 0) + sec;
  const { [video.id]: _, ...rest } = p.progress;
  if (video.durationSec > 0 && played >= video.durationSec * WATCHED_FRACTION) {
    return { progress: { ...p, progress: rest, watched: { ...p.watched, [video.id]: now }, last: video.id, lastAt: now }, completed: true };
  }
  return { progress: { ...p, progress: { ...rest, [video.id]: played }, last: video.id, lastAt: now }, completed: false };
}

export function recordFailed(p: CollectionProgress, videoId: string, now: number): CollectionProgress {
  return { ...p, failed: { ...p.failed, [videoId]: now } };
}

/** Remember where playback is, or forget it (`null`) once the video ended. */
export function recordPosition(p: CollectionProgress, videoId: string, sec: number | null): CollectionProgress {
  const { [videoId]: _, ...rest } = p.position;
  return { ...p, position: sec === null ? rest : { ...rest, [videoId]: sec } };
}

/** Where to start: the saved position, unless it is at the very start or end, or the video is a rewatch. */
export function startPosition(p: CollectionProgress, video: Pick<VideoRecord, 'id' | 'durationSec'>): number {
  if (video.id in p.watched) return 0;
  const pos = p.position[video.id] ?? 0;
  return pos > 5 && pos < video.durationSec - 15 ? Math.floor(pos) : 0;
}

// ---------- series vs free groups ----------

/** Only "series" groups: they drive today's video, the first tab and the episode-to-episode up-next. */
export function seriesOnly(data: CollectionData, config: Pick<CollectionConfig, 'groups'>): CollectionData {
  const series = new Set(config.groups.filter((g) => groupKind(g) === 'series').map((g) => g.id));
  return { ...data, groups: data.groups.filter((g) => series.has(g.id)) };
}

/** Up-next stays inside the current group for free groups, and walks the series groups otherwise. */
export function upNextScope(data: CollectionData, config: Pick<CollectionConfig, 'groups'>, current: VideoRecord): CollectionData {
  const g = config.groups.find((x) => x.id === current.group);
  if (g && groupKind(g) === 'free') return { ...data, groups: data.groups.filter((x) => x.id === current.group) };
  return seriesOnly(data, config);
}

// ---------- up next (P3) ----------

/** The episode right after `currentId` in viewing order, regardless of watched state. */
export function nextInOrder(data: CollectionData, currentId: string): VideoRecord | null {
  const all = viewingOrder(data);
  const i = all.findIndex((v) => v.id === currentId);
  return i < 0 ? null : (all[i + 1] ?? null);
}

export type UpNext =
  | { kind: 'next'; video: VideoRecord; newGroup: boolean }
  | { kind: 'limit' }
  | { kind: 'done' };

/**
 * P3: what the up-next card and the end overlay offer. `remainingSec` is the time left in the current
 * episode; a minutes limit that this episode will use up already shows the moon.
 */
export function upNext(
  data: CollectionData,
  current: VideoRecord,
  today: TodayState,
  limits: Limits,
  remainingSec: number,
): UpNext {
  // The current episode will have counted by its end, even if it started less than 10 s ago.
  const started = today.started.includes(current.id) ? today.started : [...today.started, current.id];
  const projected = { ...today, started, seconds: today.seconds + Math.max(0, remainingSec) };
  if (limitReached(projected, limits)) return { kind: 'limit' };
  const next = nextInOrder(data, current.id);
  if (!next) return { kind: 'done' };
  return { kind: 'next', video: next, newGroup: next.group !== current.group };
}

export type ProfileGate =
  | { kind: 'auto'; profileId: string }
  | { kind: 'choose'; allowed: Set<string> };

/**
 * L5: one profile per device per day. A pinned device or a single profile skips the picker;
 * once a profile was used today, the others stay closed until local midnight.
 */
export function profileGate(
  profiles: Profile[],
  device: DeviceToday | null,
  pinned: string | null,
  today: string,
): ProfileGate {
  const ids = profiles.map((p) => p.id);
  if (pinned && ids.includes(pinned)) return { kind: 'auto', profileId: pinned };
  if (ids.length === 1) return { kind: 'auto', profileId: ids[0]! };
  if (device && device.date === today && ids.includes(device.profileId)) {
    return { kind: 'choose', allowed: new Set([device.profileId]) };
  }
  return { kind: 'choose', allowed: new Set(ids) };
}
