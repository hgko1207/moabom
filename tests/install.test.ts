import { describe, expect, it } from 'vitest';
import { detectPlatform } from '../src/install.ts';

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; SM-S938N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 15; SM-S938N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/150.0 Mobile/15E148 Safari/604.1',
  iphoneKakao: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.8.0',
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};

describe('detectPlatform', () => {
  it('reports standalone first, whatever the browser', () => {
    expect(detectPlatform(UA.androidChrome, true, 5)).toBe('standalone');
  });

  it('tells Android Chrome from Samsung Internet', () => {
    expect(detectPlatform(UA.androidChrome, false, 5)).toBe('android');
    expect(detectPlatform(UA.samsung, false, 5)).toBe('samsung');
  });

  it('sends iOS browsers other than Safari, including in-app browsers, to Safari', () => {
    expect(detectPlatform(UA.iphoneSafari, false, 5)).toBe('ios-safari');
    expect(detectPlatform(UA.iphoneChrome, false, 5)).toBe('ios-other');
    expect(detectPlatform(UA.iphoneKakao, false, 5)).toBe('ios-other');
  });

  it('detects iPadOS by touch points despite its Mac user agent', () => {
    expect(detectPlatform(UA.ipadSafari, false, 5)).toBe('ios-safari');
    expect(detectPlatform(UA.ipadSafari, false, 0)).toBe('desktop');
    expect(detectPlatform(UA.windowsChrome, false, 0)).toBe('desktop');
  });
});
