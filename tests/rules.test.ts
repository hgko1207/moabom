import { describe, expect, it } from 'vitest';
import type { CollectionData, Profile } from '../src/config.ts';
import {
  canStart,
  effectiveLimits,
  recordPosition,
  recordStopped,
  seriesOnly,
  shouldCutAtLimit,
  startPosition,
  upNextScope,
  initialGroup,
  isStale,
  limitReached,
  localDate,
  nextInOrder,
  nextToWatch,
  profileGate,
  recordFailed,
  recordFinished,
  recordPlay,
  recordProgress,
  resumableAfterLimit,
  upNext,
} from '../src/rules.ts';
import type { CollectionProgress, TodayState } from '../src/storage.ts';

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
  position: {},
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

const day = (over: Partial<TodayState> = {}): TodayState => ({
  date: '2026-10-12',
  started: [],
  finished: [],
  playedToday: {},
  seconds: 0,
  stopped: [],
  ...over,
});
const eps = (n: number | null) => ({ dailyEpisodes: n, dailyMinutes: null });

describe('daily limit (L1-L3a)', () => {
  it('counts a video once it played 10 s today, and only once', () => {
    let t = recordPlay(day(), 'a', 9);
    expect(t.started).toEqual([]);
    t = recordPlay(t, 'a', 1);
    expect(t.started).toEqual(['a']);
    t = recordPlay(t, 'a', 30);
    expect(t).toMatchObject({ started: ['a'], seconds: 40, playedToday: { a: 40 } });
  });

  it('blocks new episodes at the episode limit and treats both limits null as unlimited', () => {
    expect(limitReached(day({ started: ['a', 'b'] }), eps(3))).toBe(false);
    expect(limitReached(day({ started: ['a', 'b', 'c'] }), eps(3))).toBe(true);
    expect(limitReached(day({ started: ['a', 'b', 'c'], seconds: 9999 }), eps(null))).toBe(false);
  });

  it('blocks at the minutes limit', () => {
    const limits = { dailyEpisodes: null, dailyMinutes: 10 };
    expect(limitReached(day({ seconds: 599 }), limits)).toBe(false);
    expect(limitReached(day({ seconds: 600 }), limits)).toBe(true);
  });

  it('lets only the last started episode reopen after the limit, and only while unfinished (L3a)', () => {
    const t = day({ started: ['a', 'b', 'c'] });
    expect(canStart(t, eps(3), 'c')).toBe(true);
    expect(canStart(t, eps(3), 'b')).toBe(false);
    expect(canStart(t, eps(3), 'z')).toBe(false);
    expect(canStart(recordFinished(t, 'c'), eps(3), 'c')).toBe(false);
    expect(resumableAfterLimit(recordFinished(t, 'c'))).toBeNull();
  });
});

describe('recordProgress (O1)', () => {
  const v = { id: 'a', durationSec: 300 };

  it('accumulates across sessions and marks watched at 90%', () => {
    let r = recordProgress(progress(), v, 200, 1);
    expect(r).toMatchObject({ completed: false, progress: { progress: { a: 200 }, last: 'a' } });
    r = recordProgress(r.progress, v, 70, 2);
    expect(r.completed).toBe(true);
    expect(r.progress.watched).toEqual({ a: 2 });
    expect(r.progress.progress).toEqual({});
  });

  it('records nothing new when rewatching (R5)', () => {
    const r = recordProgress(progress(['a']), v, 300, 99);
    expect(r.completed).toBe(false);
    expect(r.progress.watched).toEqual({ a: 1 });
    expect(r.progress.progress).toEqual({});
  });

  it('marks failures separately', () => {
    expect(recordFailed(progress(), 'a', 5).failed).toEqual({ a: 5 });
  });
});

describe('upNext (P3)', () => {
  const a = data.groups[0]!.videos[0]!;
  const b = data.groups[0]!.videos[1]!;
  const d = data.groups[1]!.videos[1]!;

  it('offers the very next episode and flags a new group', () => {
    expect(upNext(data, a, day(), eps(3), 20)).toEqual({ kind: 'next', video: b, newGroup: false });
    expect(upNext(data, b, day(), eps(3), 20)).toMatchObject({ kind: 'next', newGroup: true });
  });

  it('shows the moon when this episode reaches the episode limit, even before it counted', () => {
    expect(upNext(data, a, day({ started: ['x', 'y'] }), eps(3), 20)).toEqual({ kind: 'limit' });
    expect(upNext(data, a, day({ started: ['x'] }), eps(3), 20)).toMatchObject({ kind: 'next' });
  });

  it('projects the remaining time against a minutes limit (R12)', () => {
    const limits = { dailyEpisodes: null, dailyMinutes: 10 };
    expect(upNext(data, a, day({ seconds: 590 }), limits, 20)).toEqual({ kind: 'limit' });
    expect(upNext(data, a, day({ seconds: 500 }), limits, 20)).toMatchObject({ kind: 'next' });
  });

  it('ends with done after the last episode', () => {
    expect(upNext(data, d, day(), eps(null), 20)).toEqual({ kind: 'done' });
    expect(nextInOrder(data, 'missing')).toBeNull();
  });
});

describe('device settings and long videos', () => {
  const profile = { dailyEpisodes: 3, dailyMinutes: null };

  it('lets device settings override the profile defaults', () => {
    expect(effectiveLimits(profile, null)).toEqual(profile);
    expect(effectiveLimits(profile, { limit: { mode: 'none', value: 0 } })).toEqual({ dailyEpisodes: null, dailyMinutes: null });
    expect(effectiveLimits(profile, { limit: { mode: 'minutes', value: 60 } })).toEqual({ dailyEpisodes: null, dailyMinutes: 60 });
    expect(effectiveLimits(profile, { limit: { mode: 'episodes', value: 2 } })).toEqual({ dailyEpisodes: 2, dailyMinutes: null });
  });

  it('cuts only long videos at the limit, and a cut video does not reopen today', () => {
    const limits = { dailyEpisodes: null, dailyMinutes: 30 };
    const t = day({ started: ['long'], seconds: 1800 });
    expect(shouldCutAtLimit(t, limits, { durationSec: 3600 })).toBe(true);
    expect(shouldCutAtLimit(t, limits, { durationSec: 300 })).toBe(false);
    expect(shouldCutAtLimit(day({ seconds: 100 }), limits, { durationSec: 3600 })).toBe(false);
    expect(canStart(t, limits, 'long')).toBe(true);
    expect(canStart(recordStopped(t, 'long'), limits, 'long')).toBe(false);
  });
});

describe('resume position', () => {
  const v = { id: 'a', durationSec: 3600 };

  it('starts where the video stopped', () => {
    expect(startPosition(recordPosition(progress(), 'a', 1234.6), v)).toBe(1234);
  });

  it('starts from 0 near the start or end, after the end, and for rewatches', () => {
    expect(startPosition(recordPosition(progress(), 'a', 3), v)).toBe(0);
    expect(startPosition(recordPosition(progress(), 'a', 3590), v)).toBe(0);
    expect(startPosition(recordPosition(recordPosition(progress(), 'a', 900), 'a', null), v)).toBe(0);
    expect(startPosition(recordPosition(progress(['a']), 'a', 900), v)).toBe(0);
  });
});

describe('series and free groups', () => {
  const cfg = { groups: [{ id: 'lv1', label: '1' }, { id: 'lv2', label: '2', kind: 'free' as const }] };

  it('keeps free groups out of the series order', () => {
    expect(seriesOnly(data, cfg).groups.map((g) => g.id)).toEqual(['lv1']);
    expect(nextToWatch(seriesOnly(data, cfg), progress(['a', 'b']))).toBeNull();
  });

  it('keeps up-next inside a free group and ends there', () => {
    const c = data.groups[1]!.videos[0]!;
    const d = data.groups[1]!.videos[1]!;
    expect(upNext(upNextScope(data, cfg, c), c, day(), eps(null), 20)).toMatchObject({ kind: 'next', video: { id: 'd' } });
    expect(upNext(upNextScope(data, cfg, d), d, day(), eps(null), 20)).toEqual({ kind: 'done' });
    const b = data.groups[0]!.videos[1]!;
    expect(upNext(upNextScope(data, cfg, b), b, day(), eps(null), 20)).toEqual({ kind: 'done' });
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
