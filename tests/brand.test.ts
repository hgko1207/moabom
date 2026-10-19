// The mark, the brand images and the link-preview tags stay in step (design P1-1, P1-9).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOGO_PATHS } from '../src/logo.ts';

const read = (path: string) => readFileSync(path, 'utf8');

/** Width and height from a PNG header. */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const paths = (s: string) => [...s.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);

describe('brand', () => {
  it('draws the same mark in the app, public/logo.svg and scripts/brand.html', () => {
    const mark = paths(LOGO_PATHS);
    expect(mark).toHaveLength(3);
    expect(paths(read('public/logo.svg'))).toEqual(mark);
    expect(paths(read('scripts/brand.html'))).toEqual(mark);
  });

  it('has every image the manifest and index.html name, at its size', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as { icons: { src: string; sizes: string }[] };
    for (const i of manifest.icons) {
      const [w, h] = pngSize(`public${i.src}`);
      expect(`${w}x${h}`).toBe(i.sizes);
    }
    expect(pngSize('public/apple-touch-icon.png')).toEqual([180, 180]);
    expect(pngSize('public/og.png')).toEqual([1200, 630]);
  });

  it('gives link previews absolute addresses on the promo domain', () => {
    const html = read('index.html');
    const meta = (p: string) => new RegExp(`<meta (?:property|name)="${p}" content="([^"]+)"`).exec(html)?.[1];
    expect(meta('og:title')).toBe('모아봄');
    expect(meta('og:description')).toBe('공식 채널 영상만, 순서대로. 고를 필요 없어요');
    expect(meta('og:url')).toBe('https://moabom.hgko.dev/');
    expect(meta('og:image')).toBe('https://moabom.hgko.dev/og.png');
    expect(meta('twitter:card')).toBe('summary_large_image');
  });
});
