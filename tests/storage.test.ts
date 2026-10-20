import { describe, expect, it } from 'vitest';
import { createStore, type KV } from '../src/storage.ts';

function mapKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const broken: KV = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('createStore', () => {
  it('round-trips progress under versioned keys', () => {
    const kv = mapKV();
    const store = createStore(kv);
    store.saveProgress('home', 'nb', { watched: { a: 1 }, progress: {}, failed: {}, position: {}, last: 'a' });
    expect(store.progress('home', 'nb').watched).toEqual({ a: 1 });
    expect([...kv.data.keys()]).toEqual(['moabom:v1:home:nb']);
  });

  it('returns empty progress for unknown or corrupted entries', () => {
    const kv = mapKV();
    kv.data.set('moabom:v1:home:nb', '{not json');
    expect(createStore(kv).progress('home', 'nb')).toEqual({ watched: {}, progress: {}, failed: {}, position: {}, last: null });
  });

  it('starts a fresh day when the stored date differs', () => {
    const store = createStore(mapKV());
    store.saveToday('home', { date: '2026-10-11', started: ['a'], finished: [], playedToday: {}, seconds: 300, stopped: [] });
    expect(store.today('home', '2026-10-12')).toEqual({
      date: '2026-10-12',
      started: [],
      finished: [],
      playedToday: {},
      seconds: 0,
      stopped: [],
    });
    expect(store.today('home', '2026-10-11').started).toEqual(['a']);
  });

  it('reads state saved by the previous version without the new fields', () => {
    const kv = mapKV();
    kv.data.set('moabom:v1:home:today', JSON.stringify({ date: '2026-10-12', started: ['a'], finished: [], playedToday: {}, seconds: 5 }));
    kv.data.set('moabom:v1:home:nb', JSON.stringify({ watched: { a: 1 }, progress: {}, failed: {}, last: 'a' }));
    const store = createStore(kv);
    expect(store.today('home', '2026-10-12').stopped).toEqual([]);
    expect(store.progress('home', 'nb').position).toEqual({});
    expect(store.settings()).toBeNull();
  });

  it('keeps working for the session when storage throws', () => {
    const store = createStore(broken);
    store.savePinned('b');
    expect(store.pinned()).toBe('b');
    expect(store.progress('home', 'nb').watched).toEqual({});
  });
});

describe('오늘만 더 in today (P2-3)', () => {
  it('keeps extras through a reload and reads an older day without them as none', () => {
    const kv = mapKV();
    const store = createStore(kv);
    const base = { date: '2026-10-20', started: ['a'], finished: [], playedToday: { a: 30 }, seconds: 30, stopped: [] };
    store.saveToday('home', { ...base, extraEpisodes: 2, extraSeconds: 600 });
    expect(createStore(kv).today('home', '2026-10-20')).toMatchObject({ extraEpisodes: 2, extraSeconds: 600 });
    kv.data.set('moabom:v1:home:today', JSON.stringify(base));
    const old = createStore(kv).today('home', '2026-10-20');
    expect(old.extraEpisodes ?? 0).toBe(0);
    expect(old.extraSeconds ?? 0).toBe(0);
    // a new day drops them
    store.saveToday('home', { ...base, extraEpisodes: 2 });
    expect(createStore(kv).today('home', '2026-10-21').extraEpisodes).toBeUndefined();
  });
});

describe('device keys added for phase 1', () => {
  it('keeps the gate lock, stats switch, read news and intro card per device', () => {
    const kv = mapKV();
    const store = createStore(kv);
    expect(store.gateLock()).toBeNull();
    expect(store.analytics()).toBeNull();
    expect(store.newsRead()).toEqual([]);
    expect(store.introDismissed()).toBe(false);
    store.saveGateLock({ date: '2026-10-19', wrong: 3, locks: 1, until: 30_000 });
    store.saveAnalytics('off');
    store.saveNewsRead(['launch']);
    store.dismissIntro();
    const again = createStore(kv);
    expect(again.gateLock()).toEqual({ date: '2026-10-19', wrong: 3, locks: 1, until: 30_000 });
    expect(again.analytics()).toBe('off');
    expect(again.newsRead()).toEqual(['launch']);
    expect(again.introDismissed()).toBe(true);
    expect(kv.data.get('moabom:v1:device:analytics')).toBe('"off"');
  });

  it('reads junk in the new keys as their defaults', () => {
    const kv = mapKV();
    kv.data.set('moabom:v1:device:analytics', '"maybe"');
    kv.data.set('moabom:v1:device:newsRead', '{"a":1}');
    const store = createStore(kv);
    expect(store.analytics()).toBeNull();
    expect(store.newsRead()).toEqual([]);
  });
});
