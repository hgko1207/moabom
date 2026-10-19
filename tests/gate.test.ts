import { describe, expect, it } from 'vitest';
import {
  freshLock,
  koreanNumber,
  lockRemaining,
  MAX_LOCK_MS,
  newProblem,
  parentRouteDecision,
  recordRight,
  recordWrong,
  waitText,
  type GateInput,
  type LockState,
} from '../src/gate.ts';

describe('koreanNumber', () => {
  it.each([
    [100, '백'],
    [101, '백일'],
    [110, '백십'],
    [111, '백십일'],
    [200, '이백'],
    [327, '삼백이십칠'],
    [999, '구백구십구'],
    [1, '일'],
    [10, '십'],
    [25, '이십오'],
  ])('%i → %s', (n, words) => {
    expect(koreanNumber(n)).toBe(words);
  });

  it('rejects numbers outside 1..999', () => {
    expect(() => koreanNumber(0)).toThrow();
    expect(() => koreanNumber(1000)).toThrow();
  });
});

describe('newProblem', () => {
  it('always asks a three-digit number', () => {
    expect(newProblem(() => 0)).toEqual({ text: '백', answer: '100' });
    expect(newProblem(() => 0.9999)).toEqual({ text: '구백구십구', answer: '999' });
  });
});

describe('failure lock', () => {
  const day = '2026-10-19';
  const wrongTimes = (n: number, start: LockState | null = null, now = 0) => {
    let s = start;
    for (let i = 0; i < n; i++) s = recordWrong(s, now, day);
    return s!;
  };

  it('locks on every third wrong answer: 30 s, 1, 2, 4, 5, 5 min', () => {
    const seen: number[] = [];
    let s: LockState | null = null;
    for (let lock = 0; lock < 6; lock++) {
      s = wrongTimes(2, s);
      expect(lockRemaining(s, 0, day)).toBe(0);
      s = recordWrong(s, 0, day);
      seen.push(lockRemaining(s, 0, day));
      s = { ...s, until: 0 }; // the wait is over
    }
    expect(seen).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });

  it('two wrong answers do not lock', () => {
    expect(lockRemaining(wrongTimes(2), 0, day)).toBe(0);
  });

  it('counts down with the clock', () => {
    const s = wrongTimes(3, null, 1000);
    expect(lockRemaining(s, 1000 + 10_000, day)).toBe(20_000);
    expect(lockRemaining(s, 1000 + 31_000, day)).toBe(0);
  });

  it('a right answer starts over: the next lock is 30 s again', () => {
    let s = wrongTimes(3);
    s = wrongTimes(3, { ...s, until: 0 });
    expect(lockRemaining(s, 0, day)).toBe(60_000);
    s = recordRight(day);
    expect(s).toEqual(freshLock(day));
    expect(lockRemaining(wrongTimes(3, s), 0, day)).toBe(30_000);
  });

  it('a new day starts over', () => {
    const s = wrongTimes(3);
    expect(lockRemaining(s, 0, '2026-10-20')).toBe(0);
    expect(recordWrong(s, 0, '2026-10-20')).toEqual({ date: '2026-10-20', wrong: 1, locks: 0, until: 0 });
  });

  it('never waits more than 5 minutes when the device clock was set back', () => {
    const s = wrongTimes(3, null, 10 * 60 * 60 * 1000);
    expect(lockRemaining(s, 0, day)).toBe(MAX_LOCK_MS);
  });
});

describe('waitText', () => {
  it.each([
    [45_000, '45초'],
    [44_200, '45초'],
    [60_000, '1분'],
    [80_000, '1분 20초'],
    [300_000, '5분'],
  ])('%i ms → %s', (ms, text) => {
    expect(waitText(ms)).toBe(text);
  });
});

describe('parentRouteDecision', () => {
  const base: GateInput = { kind: 'parent', sameScreen: false, now: 1_000_000, unlockedUntil: null, lockMs: 0 };

  it('asks before any parent screen while locked', () => {
    expect(parentRouteDecision(base)).toEqual({ draw: 'gate', unlockedUntil: null });
  });

  it('shows the lock screen while a failure lock runs', () => {
    expect(parentRouteDecision({ ...base, lockMs: 5000 })).toEqual({ draw: 'locked', unlockedUntil: null });
  });

  it('moves between parent screens within 5 minutes without asking again', () => {
    expect(parentRouteDecision({ ...base, unlockedUntil: base.now + 1 })).toEqual({ draw: 'screen', unlockedUntil: base.now + 1 });
  });

  it('keeps an open screen after the 5 minutes (no kick-out mid-edit)', () => {
    const expired = { ...base, unlockedUntil: base.now - 1 };
    expect(parentRouteDecision({ ...expired, sameScreen: true }).draw).toBe('screen');
  });

  it('asks again when moving to another parent screen after the 5 minutes', () => {
    expect(parentRouteDecision({ ...base, unlockedUntil: base.now - 1 })).toEqual({ draw: 'gate', unlockedUntil: null });
  });

  it('ends the unlock on child screens', () => {
    expect(parentRouteDecision({ ...base, kind: 'child', unlockedUntil: base.now + 1 })).toEqual({ draw: 'screen', unlockedUntil: null });
  });

  it('the install guide neither asks nor ends an unlock', () => {
    expect(parentRouteDecision({ ...base, kind: 'neutral' })).toEqual({ draw: 'screen', unlockedUntil: null });
    expect(parentRouteDecision({ ...base, kind: 'neutral', unlockedUntil: base.now + 1 })).toEqual({ draw: 'screen', unlockedUntil: base.now + 1 });
  });
});
