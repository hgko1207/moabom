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
    store.saveProgress('home', 'nb', { watched: { a: 1 }, progress: {}, failed: {}, last: 'a' });
    expect(store.progress('home', 'nb').watched).toEqual({ a: 1 });
    expect([...kv.data.keys()]).toEqual(['moabom:v1:home:nb']);
  });

  it('returns empty progress for unknown or corrupted entries', () => {
    const kv = mapKV();
    kv.data.set('moabom:v1:home:nb', '{not json');
    expect(createStore(kv).progress('home', 'nb')).toEqual({ watched: {}, progress: {}, failed: {}, last: null });
  });

  it('starts a fresh day when the stored date differs', () => {
    const store = createStore(mapKV());
    store.saveToday('home', { date: '2026-10-11', started: ['a'], finished: [], playedToday: {}, seconds: 300 });
    expect(store.today('home', '2026-10-12')).toEqual({
      date: '2026-10-12',
      started: [],
      finished: [],
      playedToday: {},
      seconds: 0,
    });
    expect(store.today('home', '2026-10-11').started).toEqual(['a']);
  });

  it('keeps working for the session when storage throws', () => {
    const store = createStore(broken);
    store.savePinned('b');
    expect(store.pinned()).toBe('b');
    expect(store.progress('home', 'nb').watched).toEqual({});
  });
});
