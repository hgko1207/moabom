// public/privacy.html repeats the app's 이용 안내 screen for people outside the app (R17); keep the two in step.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('public/privacy.html', 'utf8');
const screen = readFileSync('src/screens/settings.ts', 'utf8');

describe('public/privacy.html', () => {
  it('says what the about screen says', () => {
    const paragraphs = [...page.matchAll(/<p>([^<]+)<\/p>/g)].map((m) => m[1]!.trim());
    expect(paragraphs.length).toBeGreaterThanOrEqual(5);
    for (const p of paragraphs) expect(screen, p).toContain(p);
  });

  it('carries the same edit date', () => {
    const date = /고친 날짜: (\d{4}-\d{2}-\d{2})/.exec(page)?.[1];
    expect(screen).toContain(`const ABOUT_EDITED = '${date}';`);
  });

  it('loads no script', () => {
    expect(page).not.toMatch(/<script/i);
  });
});
