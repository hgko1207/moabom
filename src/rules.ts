// Pure viewing rules (SPEC §8). No DOM, no storage: everything is passed in so it can be unit-tested.

import type { CollectionData, Profile, VideoRecord } from './config.ts';
import type { CollectionProgress, DeviceToday } from './storage.ts';

export const STALE_DAYS = 30;

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
