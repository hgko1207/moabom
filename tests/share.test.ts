import { describe, expect, it } from 'vitest';
import { decodeSettings, encodeSettings, settingsFromText, settingsLink } from '../src/share.ts';
import type { DeviceSettings } from '../src/storage.ts';

const full: DeviceSettings = {
  limit: { mode: 'minutes', value: 60 },
  hidden: ['kebikids'],
  order: ['octonauts', 'numberblocks', 'bluey'],
  title: '지우네 극장',
  homeContinue: false,
};

describe('settings share code', () => {
  it('round-trips every setting, Korean title included, in a URL-safe code', () => {
    const code = encodeSettings(full);
    expect(code).toMatch(/^s1\.[A-Za-z0-9_-]+$/);
    expect(decodeSettings(code)).toEqual(full);
    expect(decodeSettings(encodeSettings({ limit: { mode: 'none', value: 0 } }))).toEqual({ limit: { mode: 'none', value: 0 } });
  });

  it('reads a whole pasted link as well as the bare code', () => {
    const link = settingsLink('https://moabom.hgko.dev', '/', full);
    expect(link.startsWith('https://moabom.hgko.dev/?settings=s1.')).toBe(true);
    expect(settingsFromText(`  ${link}  `)).toEqual(full);
    expect(settingsFromText(`보내 준 링크: ${link}#/p/home`)).toEqual(full);
    expect(settingsFromText(encodeSettings(full))).toEqual(full);
  });

  it('rejects anything malformed instead of applying it', () => {
    const enc = (o: unknown) => 's1.' + Buffer.from(JSON.stringify(o)).toString('base64url');
    expect(decodeSettings('hello')).toBeNull();
    expect(decodeSettings('s1.@@@')).toBeNull();
    expect(decodeSettings(enc({ limit: { mode: 'forever', value: 1 } }))).toBeNull();
    expect(decodeSettings(enc({ limit: { mode: 'minutes', value: -5 } }))).toBeNull();
    expect(decodeSettings(enc({ limit: { mode: 'none', value: 0 }, hidden: 'bluey' }))).toBeNull();
    expect(settingsFromText('https://moabom.hgko.dev/#/p/home')).toBeNull();
  });

  it('carries the player buttons (P2-1) and rejects non-boolean values', () => {
    const enc = (o: unknown) => 's1.' + Buffer.from(JSON.stringify(o)).toString('base64url');
    const limit = { mode: 'none' as const, value: 0 };
    const withButtons = { limit, player: { prev: true, next: true, replay: false } };
    expect(decodeSettings(encodeSettings(withButtons))).toEqual(withButtons);
    expect(decodeSettings(enc({ limit, player: { next: 'yes' } }))).toBeNull();
    expect(decodeSettings(enc({ limit, player: ['next'] }))).toBeNull();
    // unknown button names are left out, not applied
    expect(decodeSettings(enc({ limit, player: { next: true, turbo: true } }))).toEqual({ limit, player: { next: true } });
  });

  it('carries YouTube 버튼 막기 with the buttons', () => {
    const limit = { mode: 'none' as const, value: 0 };
    const shielded = { limit, player: { shield: true } };
    expect(decodeSettings(encodeSettings(shielded))).toEqual(shielded);
  });
});
