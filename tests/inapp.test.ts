// The inline escape script in index.html, run in a VM with a stand-in browser (no DOM library).
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { COUNT_URL, OPT_OUT_KEY } from '../src/analytics.ts';

const html = readFileSync('index.html', 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).find((s) => s.includes('__moabomInApp'))!;

const UA = {
  kakaoAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 KAKAOTALK/10.9.0 (INAPP)',
  kakaoIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.0',
  instaAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Instagram 350.0.0.0 Android',
  instaIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0',
  naverIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.7.0)',
  bandAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 BAND/15.0.0',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]',
  daumAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 DaumApps/8.0',
  lineIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0',
  everytime: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 everytimeApp',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  crios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
  whale: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Whale/3.28.0 Mobile Safari/537.36',
};

interface FakeEl {
  className: string;
  innerHTML: string;
  textContent: string;
  listeners: Record<string, () => void>;
  children: FakeEl[];
  setAttribute(): void;
  appendChild(c: FakeEl): void;
  querySelector(sel: string): FakeEl;
  addEventListener(type: string, fn: () => void): void;
}

function el(): FakeEl {
  const parts: Record<string, FakeEl> = {};
  const e: FakeEl = {
    className: '',
    innerHTML: '',
    textContent: '',
    listeners: {},
    children: [],
    setAttribute() {},
    appendChild(c) {
      e.children.push(c);
    },
    querySelector(sel) {
      return (parts[sel] ??= el());
    },
    addEventListener(type, fn) {
      e.listeners[type] = fn;
    },
  };
  return e;
}

function run(ua: string, opts: { search?: string; optedOut?: boolean } = {}) {
  const images: string[] = [];
  const domReady: (() => void)[] = [];
  const prepended: FakeEl[] = [];
  const location = { origin: 'https://moabom.hgko.dev', pathname: '/', search: opts.search ?? '', hash: '#/p/home', href: 'https://moabom.hgko.dev/' };
  const window: Record<string, unknown> = {
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'DOMContentLoaded') domReady.push(fn);
    },
    dispatchEvent() {},
  };
  const sandbox = {
    window,
    navigator: { userAgent: ua, clipboard: { writeText: () => Promise.resolve() } },
    location,
    URLSearchParams,
    Math,
    Event: class {},
    localStorage: { getItem: (k: string) => (k === OPT_OUT_KEY && opts.optedOut ? '"off"' : null) },
    Image: class {
      set src(v: string) {
        images.push(v);
      }
    },
    document: {
      createElement: () => el(),
      body: { prepend: (e: FakeEl) => prepended.push(e) },
    },
    encodeURIComponent,
  };
  runInNewContext(script, sandbox);
  domReady.forEach((f) => f());
  return { window, location, images, bar: prepended[0] };
}

describe('in-app browser escape (index.html)', () => {
  it('catches in-app browsers', () => {
    for (const ua of [UA.kakaoAndroid, UA.kakaoIos, UA.instaAndroid, UA.instaIos, UA.naverIos, UA.bandAndroid, UA.facebookIos, UA.daumAndroid, UA.lineIos, UA.everytime]) {
      expect(run(ua).window.__moabomInApp, ua).toBeTypeOf('string');
    }
  });

  it('leaves real browsers alone', () => {
    for (const ua of [UA.chromeAndroid, UA.samsung, UA.safari, UA.crios, UA.whale]) {
      const r = run(ua);
      expect(r.window.__moabomInApp, ua).toBeUndefined();
      expect(r.location.href).toBe('https://moabom.hgko.dev/');
      expect(r.bar).toBeUndefined();
    }
  });

  it('moves Android in-app pages to Chrome, keeping ?ref= and adding a fallback with esc=1', () => {
    const r = run(UA.instaAndroid, { search: '?ref=insta' });
    expect(r.window.__moabomEscaping).toBe(true);
    expect(r.location.href).toBe(
      'intent://moabom.hgko.dev/?ref=insta#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' +
        encodeURIComponent('https://moabom.hgko.dev/?ref=insta&esc=1') +
        ';end',
    );
    expect(r.images).toEqual([expect.stringMatching(/^https:\/\/moabom\.goatcounter\.com\/count\?p=inapp_escape\.insta&e=true&rnd=\d+$/)]);
    expect(r.bar!.innerHTML).toContain('브라우저로 열기');
  });

  it('uses the KakaoTalk scheme on iOS', () => {
    const r = run(UA.kakaoIos, { search: '?ref=kakao' });
    expect(r.window.__moabomEscaping).toBe(true);
    expect(r.location.href).toBe(`kakaotalk://web/openExternal?url=${encodeURIComponent('https://moabom.hgko.dev/?ref=kakao')}`);
  });

  it('does not move again when the Android fallback came back here (esc=1)', () => {
    const r = run(UA.kakaoAndroid, { search: '?ref=kakao&esc=1' });
    expect(r.window.__moabomEscaping).toBeUndefined();
    expect(r.location.href).toBe('https://moabom.hgko.dev/');
    expect(r.images).toEqual([]);
    // the bar's button still offers the move, without esc in the main address
    expect(r.bar!.innerHTML).toContain('브라우저로 열기');
    r.bar!.querySelector('[data-escape="open"]').listeners.click!();
    expect(r.location.href).toMatch(/^intent:\/\/moabom\.hgko\.dev\/\?ref=kakao#Intent;/);
  });

  it('keeps iOS pages of other apps open with a copy button, no escape count (R8)', () => {
    const r = run(UA.instaIos, { search: '?ref=insta' });
    expect(r.window.__moabomInApp).toBe('insta');
    expect(r.window.__moabomEscaping).toBeUndefined();
    expect(r.location.href).toBe('https://moabom.hgko.dev/');
    expect(r.images).toEqual([]);
    expect(r.bar!.innerHTML).toContain('주소 복사');
    expect(r.bar!.querySelector('p').textContent).toContain('외부 브라우저에서 열기');
  });

  it('sends nothing from a device that turned stats off', () => {
    const r = run(UA.kakaoAndroid, { optedOut: true });
    expect(r.window.__moabomEscaping).toBe(true);
    expect(r.images).toEqual([]);
  });

  it('uses the same count address and opt-out key as src/analytics.ts', () => {
    expect(script).toContain(`var COUNT_URL = '${COUNT_URL}';`);
    expect(script).toContain(`var OPT_OUT_KEY = '${OPT_OUT_KEY}';`);
  });
});
