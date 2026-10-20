// The parent gate (엄마 문, design P1-4): a three-digit number written in Korean words that the parent types
// as digits. Pure rules only, no DOM: the screen lives in screens/gate.ts and render() asks
// parentRouteDecision() before drawing a parent screen.
//
// Failure lock, counted per local day and saved so a reload does not clear it:
//
//   wrong ×3 ──▶ locked 30 s ──▶ wrong ×3 ──▶ 1 min ──▶ 2 min ──▶ 4 min ──▶ 5 min ──▶ 5 min …
//      ▲                                                                       │
//      └──────────── a right answer, or a new day, starts over ◀───────────────┘
//
// The unlock itself lives in memory only (a reload locks again) and lasts 5 minutes; it is checked when a
// screen is drawn, never by a timer, so a parent is not thrown out mid-edit.

const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];

/** Sino-Korean words for 1..999 as written on a cheque: 100 → 백, 110 → 백십, 327 → 삼백이십칠. */
export function koreanNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999) throw new RangeError(`koreanNumber: ${n}`);
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  const place = (d: number, unit: string) => (d === 0 ? '' : `${d === 1 ? '' : DIGITS[d]}${unit}`);
  return `${place(h, '백')}${place(t, '십')}${DIGITS[o]}`;
}

export interface Problem {
  /** what the screen shows, e.g. 삼백이십칠 */
  text: string;
  /** the digits to type, e.g. 327 */
  answer: string;
}

export const ANSWER_DIGITS = 3;

/** A new three-digit problem (100..999). */
export function newProblem(random: () => number = Math.random): Problem {
  const n = 100 + Math.floor(random() * 900);
  return { text: koreanNumber(n), answer: String(n) };
}

// ---------- failure lock ----------

export interface LockState {
  /** local date (YYYY-MM-DD) the counts belong to */
  date: string;
  /** wrong answers since the last right answer */
  wrong: number;
  /** locks served so far; picks the next length from LOCK_STEPS_MS */
  locks: number;
  /** epoch ms when the current lock ends; 0 when not locked */
  until: number;
}

export const WRONG_PER_LOCK = 3;
export const LOCK_STEPS_MS = [30_000, 60_000, 120_000, 240_000, 300_000] as const;
export const MAX_LOCK_MS = 300_000;

export function freshLock(date: string): LockState {
  return { date, wrong: 0, locks: 0, until: 0 };
}

/** A stored state from another day reads as a fresh one. */
function current(s: LockState | null, date: string): LockState {
  return s && s.date === date ? s : freshLock(date);
}

/** Every third wrong answer starts the next lock. */
export function recordWrong(s: LockState | null, now: number, date: string): LockState {
  const c = current(s, date);
  const wrong = c.wrong + 1;
  if (wrong % WRONG_PER_LOCK !== 0) return { ...c, wrong };
  const ms = LOCK_STEPS_MS[Math.min(c.locks, LOCK_STEPS_MS.length - 1)]!;
  return { date: c.date, wrong, locks: c.locks + 1, until: now + ms };
}

/** A right answer starts the day's count over (the next lock is 30 s again). */
export function recordRight(date: string): LockState {
  return freshLock(date);
}

/** Milliseconds left on the lock; never more than 5 minutes, even if the device clock was set back. */
export function lockRemaining(s: LockState | null, now: number, date: string): number {
  const c = current(s, date);
  return Math.min(MAX_LOCK_MS, Math.max(0, c.until - now));
}

/** "1분 20초" / "45초" for the lock screen. */
export function waitText(ms: number): string {
  const sec = Math.ceil(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}초`;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

// ---------- which screens need the gate ----------

export const UNLOCK_MS = 300_000;

/**
 * parent: settings, history (need the gate). neutral: the install guide and 이용 안내 (neither asks nor ends an
 * unlock). child: everything else (ends an unlock).
 */
export type RouteKind = 'parent' | 'neutral' | 'child';

export interface GateInput {
  kind: RouteKind;
  /** the same address as the screen drawn last (a redraw after a change, not a move) */
  sameScreen: boolean;
  now: number;
  /** epoch ms the unlock ends; null when locked */
  unlockedUntil: number | null;
  /** from lockRemaining() */
  lockMs: number;
}

export interface GateDecision {
  draw: 'screen' | 'gate' | 'locked';
  /** the unlock to keep after this screen */
  unlockedUntil: number | null;
}

export function parentRouteDecision(i: GateInput): GateDecision {
  if (i.kind === 'child') return { draw: 'screen', unlockedUntil: null };
  if (i.kind === 'neutral') return { draw: 'screen', unlockedUntil: i.unlockedUntil };
  // An expired unlock still covers redraws of the open screen; moving to another parent screen asks again.
  if (i.unlockedUntil !== null && (i.now < i.unlockedUntil || i.sameScreen)) return { draw: 'screen', unlockedUntil: i.unlockedUntil };
  return { draw: i.lockMs > 0 ? 'locked' : 'gate', unlockedUntil: null };
}
