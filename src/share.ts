// Send this device's parent settings to another device as a link (?settings=<code>) or a pasted code.
// Only settings travel (limit, shown characters and their order, title, home card, player buttons); progress and
// history stay put.
// The code is versioned base64url JSON, so a later format can still read today's links.

import type { DeviceSettings, LimitMode, PlayerButtons } from './storage.ts';

const PREFIX = 's1.';
export const SETTINGS_PARAM = 'settings';

const MODES: readonly LimitMode[] = ['none', 'minutes', 'episodes'];
const PLAYER_BUTTONS = ['prev', 'next', 'replay'] as const;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSettings(s: DeviceSettings): string {
  return PREFIX + toBase64Url(JSON.stringify(s));
}

const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A settings code back to settings; null for anything malformed (never trust a pasted or linked value). */
export function decodeSettings(code: string): DeviceSettings | null {
  if (!code.startsWith(PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(code.slice(PREFIX.length)));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const limit = r.limit as Record<string, unknown> | undefined;
  if (!limit || !MODES.includes(limit.mode as LimitMode)) return null;
  const value = limit.value;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1440) return null;
  const out: DeviceSettings = { limit: { mode: limit.mode as LimitMode, value } };
  if (r.hidden !== undefined) {
    if (!isStrList(r.hidden)) return null;
    out.hidden = r.hidden;
  }
  if (r.order !== undefined) {
    if (!isStrList(r.order)) return null;
    out.order = r.order;
  }
  if (r.title !== undefined) {
    if (typeof r.title !== 'string') return null;
    out.title = r.title.slice(0, 40);
  }
  if (r.homeContinue !== undefined) {
    if (typeof r.homeContinue !== 'boolean') return null;
    out.homeContinue = r.homeContinue;
  }
  if (r.player !== undefined) {
    const p = r.player as Record<string, unknown>;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
    const buttons: PlayerButtons = {};
    for (const k of PLAYER_BUTTONS) {
      if (p[k] === undefined) continue;
      if (typeof p[k] !== 'boolean') return null;
      buttons[k] = p[k];
    }
    out.player = buttons;
  }
  return out;
}

/** The link to open on the other device. */
export function settingsLink(origin: string, path: string, s: DeviceSettings): string {
  return `${origin}${path}?${SETTINGS_PARAM}=${encodeSettings(s)}`;
}

/** Accepts a whole link (as pasted from KakaoTalk) or just the code. */
export function settingsFromText(text: string): DeviceSettings | null {
  const t = text.trim();
  const m = /[?&]settings=([^&#\s]+)/.exec(t);
  return decodeSettings(m ? decodeURIComponent(m[1]!) : t);
}
