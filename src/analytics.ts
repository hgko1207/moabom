// Anonymous counts (design P1-7): an image request to GoatCounter per event, no script, no cookie.
// GoatCounter events carry only a name, so fields are joined into it with dots (first_play.insta.numberblocks).
// Never sends a child's name, settings or history. The inline escape script in index.html sends to the same
// address and reads the same opt-out key; tests/inapp.test.ts keeps the copies equal.

/** GoatCounter site code; the dashboard is https://moabom.goatcounter.com */
export const GOATCOUNTER_CODE = 'moabom';
export const COUNT_URL = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
/** localStorage key of the opt-out switch (storage.ts `analytics()`); 'off' means do not send. */
export const OPT_OUT_KEY = 'moabom:v1:device:analytics';

/** Promo sources that get their own name; anything else counts as `other`, no ref as `direct`. */
export const REFS = ['insta', 'naver', 'kakao', 'band', 'blog'] as const;

export function normalizeRef(raw: string | null | undefined): string {
  if (!raw) return 'direct';
  const r = raw.trim().toLowerCase();
  return (REFS as readonly string[]).includes(r) ? r : 'other';
}

/** Joins fields into one event name; each field keeps only a-z, 0-9, _ and -. */
export function eventName(...parts: (string | number)[]): string {
  return parts.map((p) => String(p).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'none').join('.');
}

export function countUrl(name: string, rnd: number): string {
  return `${COUNT_URL}?p=${encodeURIComponent(name)}&e=true&rnd=${rnd}`;
}

// ---------- startup ----------

/** The query string without the given parameters ('' or '?a=b'), for history.replaceState (R19). */
export function withoutParams(search: string, names: readonly string[]): string {
  const params = new URLSearchParams(search);
  for (const n of names) params.delete(n);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

// ---------- sending ----------

export interface SessionKV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AnalyticsDeps {
  /** true when this device turned stats off */
  muted(): boolean;
  /** sessionStorage (or a stand-in): the ref and the once-per-session marks */
  session: SessionKV;
  send(url: string): void;
  random?(): number;
}

const SESSION_REF = 'moabom:ref';

export function createAnalytics(deps: AnalyticsDeps) {
  const safe = <T>(f: () => T, fallback: T): T => {
    try {
      return f();
    } catch {
      return fallback;
    }
  };
  const once = (key: string): boolean => {
    const k = `moabom:sent:${key}`;
    if (safe(() => deps.session.getItem(k), null) !== null) return false;
    safe(() => deps.session.setItem(k, '1'), undefined);
    return true;
  };
  const ref = (): string => normalizeRef(safe(() => deps.session.getItem(SESSION_REF), null));
  const count = (name: string): void => {
    if (deps.muted()) return;
    deps.send(countUrl(name, Math.floor((deps.random ?? Math.random)() * 1e9)));
  };

  return {
    /** Keeps the first ref of the session (a later page without ?ref= keeps it). */
    rememberRef(raw: string | null): void {
      if (raw !== null && safe(() => deps.session.getItem(SESSION_REF), null) === null) safe(() => deps.session.setItem(SESSION_REF, raw), undefined);
    },
    ref,
    /**
     * Once per session: the app was opened. `webview` marks a page opened inside an in-app browser (KakaoTalk,
     * Instagram …), counted apart as visit.<ref>.webview; a tap on the bar there opens a real browser (R8).
     */
    visit(webview = false): void {
      if (!deps.muted() && once('visit')) count(webview ? eventName('visit', ref(), 'webview') : eventName('visit', ref()));
    },
    /** Every video start; the first of the session also counts first_play with the ref. */
    playStart(collectionId: string): void {
      if (deps.muted()) return;
      if (once('first_play')) count(eventName('first_play', ref(), collectionId));
      count(eventName('play_start', collectionId));
    },
    /** Once per session and limit mode. */
    limitReached(mode: string): void {
      if (!deps.muted() && once(`limit.${mode}`)) count(eventName('limit_reached', mode));
    },
    videoError(videoId: string, code: number): void {
      count(eventName('video_error', videoId, code));
    },
    collectionOpen(collectionId: string): void {
      count(eventName('collection_open', collectionId));
    },
    requestClick(): void {
      count('request_click');
    },
  };
}

export type Analytics = ReturnType<typeof createAnalytics>;
