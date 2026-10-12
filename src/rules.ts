// Pure viewing rules (SPEC §8). No DOM, no storage: everything is passed in so it can be unit-tested.

import type { CollectionData, Profile, VideoRecord } from './config.ts';
import type { CollectionProgress, DeviceToday, TodayState } from './storage.ts';

export const STALE_DAYS = 30;
/** L1: seconds of playback today before a video counts toward the daily episode limit. */
export const COUNT_AFTER_SEC = 10;
/** O1: fraction of the duration that must actually be played to mark a video watched. */
export const WATCHED_FRACTION = 0.9;
/** P3: the up-next card appears when this many seconds remain. */
export const UP_NEXT_SEC = 20;

/** Device-local calendar date (YYYY-MM-DD); the daily limit resets at local midnight. */
export function localDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

type Limits = Pick<Profile, 'dailyEpisodes' | 'dailyMinutes'>;

/** L3: no new episode may start. Both limits null means unlimited. */
export function limitReached(today: TodayState, limits: Limits): boolean {
  if (limits.dailyEpisodes !== null && today.started.length >= limits.dailyEpisodes) return true;
  if (limits.dailyMinutes !== null && today.seconds >= limits.dailyMinutes * 60) return true;
  return false;
}

/** L3a: after the limit, only today's last started episode may reopen, and only while unfinished. */
export function resumableAfterLimit(today: TodayState): string | null {
  const last = today.started.at(-1);
  return last && !today.finished.includes(last) ? last : null;
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
  if (video.id in p.watched) return { progress: { ...p, last: video.id }, completed: false };
  const played = (p.progress[video.id] ?? 0) + sec;
  const { [video.id]: _, ...rest } = p.progress;
  if (video.durationSec > 0 && played >= video.durationSec * WATCHED_FRACTION) {
    return { progress: { ...p, progress: rest, watched: { ...p.watched, [video.id]: now }, last: video.id }, completed: true };
  }
  return { progress: { ...p, progress: { ...rest, [video.id]: played }, last: video.id }, completed: false };
}

export function recordFailed(p: CollectionProgress, videoId: string, now: number): CollectionProgress {
  return { ...p, failed: { ...p.failed, [videoId]: now } };
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
