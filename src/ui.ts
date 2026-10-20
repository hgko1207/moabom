// Shared screen state, routing and HTML helpers. main.ts owns render() and hands it over with setRenderer(),
// so screens can navigate without importing main.ts (no module imports main.ts).
import type { Profile, VideoRecord } from './config.ts';
import { loadAppData, type Collection } from './data.ts';
import { icon } from './icons.ts';
import { canPromptInstall, currentPlatform, promptInstall } from './install.ts';
import {
  effectiveLimits,
  heroPick,
  homeTitle,
  isSettingsSection,
  isStale,
  limitReached,
  localDate,
  orderCollectionIds,
  playerButtonOn,
  resumableAfterLimit,
  startPosition,
  viewingOrder,
  visibleCollectionIds,
  type Limits,
  type SettingsSection,
} from './rules.ts';
import { createAnalytics, type SessionKV } from './analytics.ts';
import type { PlayerHandle } from './player.ts';
import { browserKV, createStore, type CollectionProgress, type DeviceSettings, type PlayerButtons, type TodayState } from './storage.ts';

export const app = document.getElementById('app')!;
export const appData = loadAppData();
export const store = createStore(browserKV());

/** Set by the inline script in index.html before this module runs. */
declare global {
  interface Window {
    /** the in-app browser's name when the page runs inside one (kakao, insta, naver, …) */
    __moabomInApp?: string;
  }
}

function sessionKV(): SessionKV {
  try {
    return window.sessionStorage;
  } catch {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  }
}

export const analytics = createAnalytics({
  muted: () => store.analytics() === 'off',
  session: sessionKV(),
  send: (url) => {
    new Image().src = url;
  },
});

// ---------- routing: #/p/{profile}/c/{collection}[/v/{video} | /today][?g={group}] ----------

export interface Route {
  profile?: string;
  collection?: string;
  video?: string;
  today?: boolean;
  settings?: boolean;
  /** a settings sub-screen, `#/p/{pid}/settings/{section}` */
  section?: SettingsSection;
  install?: boolean;
  history?: boolean;
  about?: boolean;
  group?: string;
}

export function parseHash(): Route {
  const [path = '', query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const route: Route = {};
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (key === 'today' || key === 'settings' || key === 'install' || key === 'history' || key === 'about') {
      route[key] = true;
      if (key === 'settings' && isSettingsSection(parts[i + 1])) route.section = parts[++i] as SettingsSection;
      continue;
    }
    const value = parts[++i];
    if (value === undefined) break;
    if (key === 'p') route.profile = value;
    else if (key === 'c') route.collection = value;
    else if (key === 'v') route.video = value;
  }
  const g = new URLSearchParams(query).get('g');
  if (g) route.group = g;
  return route;
}

export function href(r: Route): string {
  let h = '#/';
  if (r.profile) h += `p/${encodeURIComponent(r.profile)}`;
  if (r.profile && r.settings) return `${h}/settings${r.section ? `/${r.section}` : ''}`;
  if (r.profile && r.install) return `${h}/install`;
  if (r.profile && r.history) return `${h}/history`;
  if (r.profile && r.about) return `${h}/about`;
  if (r.profile && r.collection) {
    h += `/c/${encodeURIComponent(r.collection)}`;
    if (r.video) h += `/v/${encodeURIComponent(r.video)}`;
    else if (r.today) h += '/today';
    else if (r.group) h += `?g=${encodeURIComponent(r.group)}`;
  }
  return h;
}

let renderer: () => void = () => {};

/** main.ts registers its render() here once at startup. */
export function setRenderer(fn: () => void): void {
  renderer = fn;
}

/** Draws the screen for the current address. */
export function render(): void {
  renderer();
}

/** Depth of app-made history entries, so ◀ can use history.back() and stay in sync with the browser back button. */
function depth(): number {
  return (history.state as { depth?: number } | null)?.depth ?? 0;
}

export function go(r: Route): void {
  history.pushState({ depth: depth() + 1 }, '', href(r));
  render();
  window.scrollTo(0, 0);
}

export function replace(r: Route): void {
  history.replaceState({ depth: depth() }, '', href(r));
  render();
}

export function backTo(parent: Route): void {
  if (depth() > 0) history.back();
  else replace(parent);
}

// ---------- the playing video ----------

let player: PlayerHandle | null = null;

/** The YouTube player on the current screen, if any; render() destroys it before drawing the next screen. */
export function activePlayer(): PlayerHandle | null {
  return player;
}

export function setActivePlayer(p: PlayerHandle | null): void {
  player = p;
}

// ---------- per-screen cleanup ----------

let teardown: (() => void)[] = [];

/** Something a screen started outside its own DOM (a timer, a document listener); undone before the next screen. */
export function onLeave(fn: () => void): void {
  teardown.push(fn);
}

/** render() runs this first, so a countdown or key listener never acts on the next screen. */
export function leaveScreen(): void {
  const fns = teardown;
  teardown = [];
  for (const fn of fns) fn();
}

// ---------- the ◀ button ----------

let onBack: (() => void) | null = null;

/** What ◀ does on the current screen; render() clears it. */
export function setBack(fn: (() => void) | null): void {
  onBack = fn;
}

export function backButton(): string {
  return `<button class="back" data-action="back" aria-label="뒤로">${icon('back', 32)}</button>`;
}

export function bindBack(): void {
  app.querySelector('[data-action="back"]')?.addEventListener('click', () => onBack?.());
  app.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload());
}

// ---------- helpers ----------

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function duration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

/** YouTube thumbnails: hq (480x360) for cards and the player, mq (320x180) for small rows and miniatures. */
export function thumbUrl(id: string, size: 'hq' | 'mq' = 'hq'): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${size}default.jpg`;
}

export function thumb(id: string, fallback: string, extra = '', eager = false): string {
  return `<div class="thumb"><img src="${thumbUrl(id)}" alt="" width="480" height="360" decoding="async"${eager ? '' : ' loading="lazy"'}><span class="fallback" aria-hidden="true">${esc(fallback)}</span>${extra}</div>`;
}

export function setAccent(color: string): void {
  document.documentElement.style.setProperty('--accent', color);
}

export function staleNote(): string {
  const now = new Date();
  const stale = [...appData.collections.values()].some((c) => isStale(c.data.fetchedAt, now));
  return stale ? '<p class="stale" role="status">데이터 갱신 필요</p>' : '';
}

export function offlineNotice(): string {
  if (navigator.onLine) return '';
  return `<div class="notice" role="status">${icon('offline', 40)}<span class="visually-hidden">인터넷 연결이 없어요</span>
    <button class="retry" data-action="reload" aria-label="다시 시도">${icon('again', 32)}</button></div>`;
}

/** A thin bar showing how far a video got, like a resume marker. Empty when it starts from the beginning. */
export function progressBar(at: number, total: number): string {
  if (at <= 0 || total <= 0) return '';
  const pct = Math.min(100, Math.max(2, Math.round((at / total) * 100)));
  return `<span class="resume-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
}

export function limitsFor(profile: Profile): Limits {
  return effectiveLimits(profile, store.settings());
}

// ---------- what a collection offers right now ----------

export interface CollectionView {
  progress: CollectionProgress;
  today: TodayState;
  limited: boolean;
  /** The card that gets the ▶ highlight: what to continue or watch next (O3b), or the resumable episode after the limit (R7). */
  highlight: VideoRecord | null;
  /** The highlight continues from a saved position. */
  resume: boolean;
}

export function collectionView(profile: Profile, c: Collection): CollectionView {
  const progress = store.progress(profile.id, c.config.id);
  const today = store.today(profile.id, localDate(new Date()));
  const limited = limitReached(today, limitsFor(profile));
  const all = viewingOrder(c.data);
  const resumable = resumableAfterLimit(today);
  if (limited) {
    const highlight = all.find((v) => v.id === resumable) ?? null;
    return { progress, today, limited, highlight, resume: highlight !== null && startPosition(progress, highlight) > 0 };
  }
  const pick = heroPick(c.data, c.config, progress, profile.startGroup?.[c.config.id]);
  return { progress, today, limited, highlight: pick?.video ?? null, resume: pick?.resume ?? false };
}

let videoCollections: Map<string, string> | null = null;

/** Which collection a video belongs to (for back-filling history from today's counters). */
export function collectionOfVideo(videoId: string): string | null {
  videoCollections ??= new Map(
    [...appData.collections.values()].flatMap((c) => viewingOrder(c.data).map((v) => [v.id, c.config.id] as const)),
  );
  return videoCollections.get(videoId) ?? null;
}

// ---------- settings links from another device ----------

/** What a settings link would set, in words, so a parent can check before applying it. */
export function describeSettings(s: DeviceSettings): string[] {
  const profile = appData.profiles[0];
  const ids = profile ? profile.collections.filter((id) => appData.collections.has(id)) : [];
  const shown = visibleCollectionIds(orderCollectionIds(ids, s), s).map((id) => appData.collections.get(id)!.config.displayName);
  const limit = s.limit.mode === 'minutes' ? `하루 ${s.limit.value}분` : s.limit.mode === 'episodes' ? `하루 ${s.limit.value}편` : '없음';
  return [
    `하루 제한: ${limit}`,
    `보여 줄 캐릭터: ${shown.join(', ')}`,
    `홈 화면 이름: ${profile ? homeTitle(profile.name, s) : ''}`,
    `맨 위 이어 보기 칸: ${s.homeContinue === false ? '꺼짐' : '켜짐'}`,
    `재생 화면 버튼: ${playerButtonNames(s.player).join(', ') || '없음'}`,
  ];
}

/** In the player's order (이전 편 · 한 번 더 · 다음 편). */
const BUTTON_NAMES = { prev: '이전 편', replay: '한 번 더', next: '다음 편' } as const;

/** The player buttons switched on, in words (P2-1). */
export function playerButtonNames(p: PlayerButtons | undefined): string[] {
  return (Object.keys(BUTTON_NAMES) as (keyof typeof BUTTON_NAMES)[]).filter((k) => playerButtonOn(p, k)).map((k) => BUTTON_NAMES[k]);
}

/**
 * A settings link waiting for a parent on the 다른 기기와 맞추기 screen, where it is shown as a card with
 * 적용 / 적용 안 함 (no browser dialog). 'invalid' when the link could not be read. Kept in memory only.
 */
let incoming: DeviceSettings | 'invalid' | null = null;

export function receiveSettings(s: DeviceSettings | null): void {
  incoming = s ?? 'invalid';
}

export function pendingSettings(): DeviceSettings | 'invalid' | null {
  return incoming;
}

/** Applies (or drops) the waiting link. Progress and history on this device are untouched. */
export function settlePendingSettings(apply: boolean): void {
  if (apply && incoming && incoming !== 'invalid') store.saveSettings(incoming);
  incoming = null;
}

// ---------- parent settings gear (long press) ----------

const HOLD_MS = 2000;

export function gearButton(): string {
  return `<button class="gear" data-action="gear" aria-label="설정 (2초 동안 누르기)">${icon('settings', 28)}<span class="hold" aria-hidden="true"></span></button>`;
}

/** Opens settings only after a 2 s press, so a child's tap does nothing (design DR17). */
export function bindGear(profileId: string): void {
  const gear = app.querySelector<HTMLButtonElement>('[data-action="gear"]');
  if (gear) bindHold(gear, () => go({ profile: profileId, settings: true }));
}

/**
 * Runs `action` only after a 2 s press (pointer or Enter/Space). A shorter press shows "2초 동안 누르세요" next to
 * the button for 2 s. Used by the settings gear and the moon screen's 오늘만 더 (R21).
 */
export function bindHold(button: HTMLElement, action: () => void): void {
  let timer = 0;
  let hintTimer = 0;
  let pressed = false;
  onLeave(() => {
    window.clearTimeout(timer);
    window.clearTimeout(hintTimer);
  });
  const start = () => {
    window.clearTimeout(timer);
    pressed = true;
    button.classList.add('holding');
    timer = window.setTimeout(() => {
      pressed = false;
      button.classList.remove('holding');
      action();
    }, HOLD_MS);
  };
  const cancel = () => {
    window.clearTimeout(timer);
    button.classList.remove('holding');
    if (!pressed) return;
    pressed = false;
    button.parentElement?.querySelector('.hold-hint')?.remove();
    button.insertAdjacentHTML('afterend', '<p class="hold-hint" role="status">2초 동안 누르세요</p>');
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => button.parentElement?.querySelector('.hold-hint')?.remove(), HOLD_MS);
  };
  button.addEventListener('pointerdown', start);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) button.addEventListener(ev, cancel);
  button.addEventListener('contextmenu', (e) => e.preventDefault());
  button.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      start();
    }
  });
  button.addEventListener('keyup', cancel);
}

// ---------- home-screen install hint ----------

/** A small dismissible card on the home screen of a phone/tablet browser tab (not shown once installed). */
export function installHint(): string {
  const p = currentPlatform();
  if (p === 'standalone' || p === 'desktop' || store.installHintDismissed()) return '';
  const action = canPromptInstall()
    ? `<button class="primary" data-action="install-now">${icon('download', 24)}앱 설치</button>`
    : '<button class="secondary" data-action="install-guide">방법 보기</button>';
  return `<aside class="install-hint" aria-label="홈 화면에 추가">
    <p>홈 화면에 추가하면 앱처럼 전체 화면으로 열려요</p>
    <button class="close" data-action="install-dismiss" aria-label="닫기">${icon('close', 24)}</button>${action}</aside>`;
}

export function bindInstallHint(profileId: string): void {
  app.querySelector('[data-action="install-now"]')?.addEventListener('click', () => void promptInstall().then(render));
  app.querySelector('[data-action="install-guide"]')?.addEventListener('click', () => go({ profile: profileId, install: true }));
  app.querySelector('[data-action="install-dismiss"]')?.addEventListener('click', () => {
    store.dismissInstallHint();
    app.querySelector('.install-hint')?.remove();
  });
}
