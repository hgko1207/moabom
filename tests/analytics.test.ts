import { describe, expect, it } from 'vitest';
import { bootActions, countUrl, createAnalytics, eventName, normalizeRef, withoutParams } from '../src/analytics.ts';

function fakeSession() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

function setup(muted = false) {
  const sent: string[] = [];
  const session = fakeSession();
  const a = createAnalytics({ muted: () => muted, session, send: (u) => sent.push(u), random: () => 0.5 });
  const names = () => sent.map((u) => decodeURIComponent(new URL(u).searchParams.get('p')!));
  return { a, sent, names, session };
}

describe('event names', () => {
  it('joins fields with dots, no leading slash', () => {
    expect(eventName('first_play', 'insta', 'numberblocks')).toBe('first_play.insta.numberblocks');
  });

  it('keeps only safe characters in each field', () => {
    expect(eventName('video_error', 'a/b?c<d', 150)).toBe('video_error.abcd.150');
    expect(eventName('visit', '')).toBe('visit.none');
  });

  it('builds the GoatCounter count address as an event', () => {
    expect(countUrl('visit.insta', 7)).toBe('https://moabom.goatcounter.com/count?p=visit.insta&e=true&rnd=7');
  });

  it('limits refs to the allowlist', () => {
    expect(normalizeRef('insta')).toBe('insta');
    expect(normalizeRef('NAVER')).toBe('naver');
    expect(normalizeRef('<script>')).toBe('other');
    expect(normalizeRef(null)).toBe('direct');
  });
});

describe('createAnalytics', () => {
  it('counts visit and first_play once per session, with the remembered ref', () => {
    const { a, names } = setup();
    a.rememberRef('insta');
    a.rememberRef('naver'); // a later page keeps the first ref
    a.visit();
    a.visit();
    a.playStart('numberblocks');
    a.playStart('bluey');
    expect(names()).toEqual(['visit.insta', 'first_play.insta.numberblocks', 'play_start.numberblocks', 'play_start.bluey']);
  });

  it('counts a visit from an in-app browser that stays open apart, as webview', () => {
    const { a, names } = setup();
    a.rememberRef('insta');
    a.visit(true);
    a.visit();
    expect(names()).toEqual(['visit.insta.webview']);
  });

  it('counts the limit once per session and mode', () => {
    const { a, names } = setup();
    a.limitReached('minutes');
    a.limitReached('minutes');
    a.limitReached('episodes');
    expect(names()).toEqual(['limit_reached.minutes', 'limit_reached.episodes']);
  });

  it('sends nothing when the device turned stats off', () => {
    const { a, sent, session } = setup(true);
    a.rememberRef('insta');
    a.visit();
    a.playStart('numberblocks');
    a.limitReached('minutes');
    a.videoError('abc', 150);
    a.collectionOpen('bluey');
    a.requestClick();
    expect(sent).toEqual([]);
    // muted events do not use up the once-per-session marks
    expect([...session.m.keys()]).toEqual(['moabom:ref']);
  });

  it('keeps working when sessionStorage throws', () => {
    const sent: string[] = [];
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    const a = createAnalytics({ muted: () => false, session: broken, send: (u) => sent.push(u) });
    a.rememberRef('insta');
    a.visit();
    expect(sent).toHaveLength(1);
  });
});

describe('bootActions', () => {
  it('does everything on a normal page', () => {
    expect(bootActions({ escaping: false })).toEqual({ applySettings: true, pinProfile: true, sendStats: true });
  });

  it('does nothing twice on a page being handed to a real browser', () => {
    expect(bootActions({ escaping: true })).toEqual({ applySettings: false, pinProfile: false, sendStats: false });
  });
});

describe('withoutParams', () => {
  it('drops only the named parameters', () => {
    expect(withoutParams('?ref=insta&esc=1&profile=home', ['ref', 'esc'])).toBe('?profile=home');
    expect(withoutParams('?ref=insta', ['ref', 'esc'])).toBe('');
    expect(withoutParams('', ['ref'])).toBe('');
  });
});
