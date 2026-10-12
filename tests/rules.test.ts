import { describe, expect, it } from 'vitest';
import type { CollectionData, Profile } from '../src/config.ts';
import { initialGroup, isStale, localDate, nextToWatch, profileGate } from '../src/rules.ts';
import type { CollectionProgress } from '../src/storage.ts';

const data: CollectionData = {
  collectionId: 'c',
  fetchedAt: '2026-10-01T00:00:00.000Z',
  groups: [
    { id: 'lv1', videos: ['a', 'b'].map((id, i) => vid(id, 'lv1', i)) },
    { id: 'lv2', videos: ['c', 'd'].map((id, i) => vid(id, 'lv2', i)) },
  ],
};

function vid(id: string, group: string, i: number) {
  return { id, title: id, displayTitle: id, durationSec: 300, channelId: 'UC', group, order: i + 1 };
}

const progress = (watched: string[] = [], failed: string[] = [], last: string | null = null): CollectionProgress => ({
  watched: Object.fromEntries(watched.map((id) => [id, 1])),
  progress: {},
  failed: Object.fromEntries(failed.map((id) => [id, 1])),
  last,
});

describe('nextToWatch (O3)', () => {
  it('picks the first unwatched video in viewing order', () => {
    expect(nextToWatch(data, progress(['a']))?.id).toBe('b');
  });

  it('starts from the start group and wraps to earlier groups when the rest is watched', () => {
    expect(nextToWatch(data, progress(), 'lv2')?.id).toBe('c');
    expect(nextToWatch(data, progress(['c', 'd']), 'lv2')?.id).toBe('a');
  });

  it('skips videos that failed to play on this device', () => {
    expect(nextToWatch(data, progress([], ['a']))?.id).toBe('b');
  });

  it('returns null when everything is watched', () => {
    expect(nextToWatch(data, progress(['a', 'b', 'c', 'd']))).toBeNull();
  });
});

describe('initialGroup (O3a)', () => {
  it('opens the group holding the next video', () => {
    expect(initialGroup(data, progress(['a', 'b']))).toBe('lv2');
  });

  it('falls back to the last watched video, then the start group', () => {
    const all = ['a', 'b', 'c', 'd'];
    expect(initialGroup(data, progress(all, [], 'b'))).toBe('lv1');
    expect(initialGroup(data, progress(all), 'lv2')).toBe('lv2');
    expect(initialGroup(data, progress(all))).toBe('lv1');
  });
});

describe('profileGate (L5)', () => {
  const p = (id: string): Profile => ({
    id,
    name: id,
    color: '#000000',
    collections: ['c'],
    dailyEpisodes: 3,
    dailyMinutes: null,
  });

  it('skips the picker for a single shared profile', () => {
    expect(profileGate([p('home')], null, null, '2026-10-12')).toEqual({ kind: 'auto', profileId: 'home' });
  });

  it('honours a pinned device', () => {
    expect(profileGate([p('a'), p('b')], null, 'b', '2026-10-12')).toEqual({ kind: 'auto', profileId: 'b' });
  });

  it('keeps other profiles closed for the rest of the day once one was used', () => {
    const gate = profileGate([p('a'), p('b')], { date: '2026-10-12', profileId: 'a' }, null, '2026-10-12');
    expect(gate).toEqual({ kind: 'choose', allowed: new Set(['a']) });
  });

  it('opens every profile again on a new day', () => {
    const gate = profileGate([p('a'), p('b')], { date: '2026-10-11', profileId: 'a' }, null, '2026-10-12');
    expect(gate).toEqual({ kind: 'choose', allowed: new Set(['a', 'b']) });
  });
});

describe('dates', () => {
  it('uses the device-local date', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('flags data older than 30 days', () => {
    expect(isStale('2026-09-01T00:00:00Z', new Date('2026-10-12T00:00:00Z'))).toBe(true);
    expect(isStale('2026-10-01T00:00:00Z', new Date('2026-10-12T00:00:00Z'))).toBe(false);
    expect(isStale('not a date', new Date())).toBe(true);
  });
});
