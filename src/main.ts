import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import type { Profile, VideoRecord } from './config.ts';
import { loadAppData, type Collection } from './data.ts';
import { icon } from './icons.ts';
import { SETTINGS_PARAM, settingsFromText, settingsLink } from './share.ts';
import { canPromptInstall, currentPlatform, onInstallChange, promptInstall, STEPS } from './install.ts';
import { createPlayer, type PlayerHandle } from './player.ts';
import {
  canStart,
  effectiveLimits,
  heroPick,
  homeTitle,
  initialGroup,
  isStale,
  limitReached,
  localDate,
  shiftDate,
  HISTORY_DAYS,
  recentDays,
  recordHistory,
  recordHistoryDone,
  withToday,
  mostRecentCollection,
  progressRecency,
  moveCollection,
  orderCollectionIds,
  profileGate,
  recordFailed,
  recordFinished,
  recordPlay,
  recordPosition,
  recordProgress,
  recordStopped,
  resumableAfterLimit,
  seriesOnly,
  shouldCutAtLimit,
  startPosition,
  TITLE_MAX,
  UP_NEXT_SEC,
  upNext,
  upNextScope,
  viewingOrder,
  visibleCollectionIds,
  type Limits,
  type UpNext,
} from './rules.ts';
import { browserKV, createStore, type CollectionProgress, type DeviceSettings, type LimitMode, type TodayState } from './storage.ts';

const app = document.getElementById('app')!;
const appData = loadAppData();
const store = createStore(browserKV());

// ---------- routing: #/p/{profile}/c/{collection}[/v/{video} | /today][?g={group}] ----------

interface Route {
  profile?: string;
  collection?: string;
  video?: string;
  today?: boolean;
  settings?: boolean;
  install?: boolean;
  history?: boolean;
  group?: string;
}

function parseHash(): Route {
  const [path = '', query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const route: Route = {};
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (key === 'today' || key === 'settings' || key === 'install' || key === 'history') {
      route[key] = true;
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

function href(r: Route): string {
  let h = '#/';
  if (r.profile) h += `p/${encodeURIComponent(r.profile)}`;
  if (r.profile && r.settings) return `${h}/settings`;
  if (r.profile && r.install) return `${h}/install`;
  if (r.profile && r.history) return `${h}/history`;
  if (r.profile && r.collection) {
    h += `/c/${encodeURIComponent(r.collection)}`;
    if (r.video) h += `/v/${encodeURIComponent(r.video)}`;
    else if (r.today) h += '/today';
    else if (r.group) h += `?g=${encodeURIComponent(r.group)}`;
  }
  return h;
}

/** Depth of app-made history entries, so ◀ can use history.back() and stay in sync with the browser back button. */
function depth(): number {
  return (history.state as { depth?: number } | null)?.depth ?? 0;
}

function go(r: Route): void {
  history.pushState({ depth: depth() + 1 }, '', href(r));
  render();
  window.scrollTo(0, 0);
}

function replace(r: Route): void {
  history.replaceState({ depth: depth() }, '', href(r));
  render();
}

function backTo(parent: Route): void {
  if (depth() > 0) history.back();
  else replace(parent);
}

window.addEventListener('popstate', () => {
  render();
  window.scrollTo(0, 0);
});
window.addEventListener('online', () => {
  if (!activePlayer) render();
});
window.addEventListener('offline', () => {
  if (!activePlayer) render();
});

// After a deploy, an app left open (a home screen app often is, for days) keeps running the old code until it is
// restarted, so new features and fixes seem missing. When the app comes back to the foreground, compare our build
// with the published one and reload if it changed; never during playback. No-op in dev (no hashed bundle).
const runningBuild = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.src;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || activePlayer || !runningBuild) return;
  try {
    const html = await (await fetch(location.pathname, { cache: 'no-store' })).text();
    const latest = /src="([^"]*\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
    if (latest && !runningBuild.endsWith(latest)) location.reload();
  } catch {
    // offline or blocked: try again next time
  }
});
onInstallChange(() => {
  if (!activePlayer) render();
});

// A device opened once with ?profile=<id> stays on that profile (SPEC L5).
{
  const pin = new URLSearchParams(location.search).get('profile');
  if (pin && appData.profiles.some((p) => p.id === pin)) store.savePinned(pin);
  if (pin !== null) history.replaceState(history.state, '', location.pathname + location.hash);
}

// A settings link from another device (?settings=<code>): confirm, apply, then drop it from the address.
{
  const params = new URLSearchParams(location.search);
  const code = params.get(SETTINGS_PARAM);
  if (code !== null) {
    params.delete(SETTINGS_PARAM);
    const rest = params.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    const incoming = settingsFromText(code);
    if (incoming) applyIncomingSettings(incoming);
    else alert('설정 링크가 올바르지 않아서 적용하지 않았어요.');
  }
}

/** What a settings link would set, in words, so a parent can check before applying it. */
function describeSettings(s: DeviceSettings): string {
  const profile = appData.profiles[0];
  const ids = profile ? profile.collections.filter((id) => appData.collections.has(id)) : [];
  const shown = visibleCollectionIds(orderCollectionIds(ids, s), s).map((id) => appData.collections.get(id)!.config.displayName);
  const limit = s.limit.mode === 'minutes' ? `하루 ${s.limit.value}분` : s.limit.mode === 'episodes' ? `하루 ${s.limit.value}편` : '없음';
  return [
    `하루 제한: ${limit}`,
    `보여 줄 캐릭터: ${shown.join(', ')}`,
    `홈 화면 이름: ${s.title?.trim() || profile?.name || ''}`,
    `맨 위 이어 보기 칸: ${s.homeContinue === false ? '꺼짐' : '켜짐'}`,
  ].join('\n');
}

/** Asks first; returns true when applied. Progress and history on this device are untouched. */
function applyIncomingSettings(s: DeviceSettings): boolean {
  if (!confirm(`다른 기기의 설정을 이 기기에 적용할까요?\n\n${describeSettings(s)}\n\n본 기록과 시청 기록은 그대로예요.`)) return false;
  store.saveSettings(s);
  return true;
}

// ---------- helpers ----------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function duration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

function thumbUrl(id: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
}

function thumb(id: string, fallback: string, extra = '', eager = false): string {
  return `<div class="thumb"><img src="${thumbUrl(id)}" alt="" width="480" height="360" decoding="async"${eager ? '' : ' loading="lazy"'}><span class="fallback" aria-hidden="true">${esc(fallback)}</span>${extra}</div>`;
}

function backButton(): string {
  return `<button class="back" data-action="back" aria-label="뒤로">${icon('back', 32)}</button>`;
}

function setAccent(color: string): void {
  document.documentElement.style.setProperty('--accent', color);
}

function staleNote(): string {
  const now = new Date();
  const stale = [...appData.collections.values()].some((c) => isStale(c.data.fetchedAt, now));
  return stale ? '<p class="stale" role="status">데이터 갱신 필요</p>' : '';
}

function offlineNotice(): string {
  if (navigator.onLine) return '';
  return `<div class="notice" role="status">${icon('offline', 40)}<span class="visually-hidden">인터넷 연결이 없어요</span>
    <button class="retry" data-action="reload" aria-label="다시 시도">${icon('again', 32)}</button></div>`;
}

// Broken thumbnails swap to the profile color with the episode number. Offline images fire `error`;
// a removed video still "loads" YouTube's 120x90 grey placeholder, so tiny images count as broken too.
function markBroken(e: Event): void {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (e.type === 'error' || img.naturalWidth <= 120) img.closest('.thumb')?.classList.add('broken');
}
app.addEventListener('error', markBroken, true);
app.addEventListener('load', markBroken, true);

// ---------- screens ----------

let onBack: (() => void) | null = null;
let activePlayer: PlayerHandle | null = null;

function render(): void {
  onBack = null;
  activePlayer?.destroy();
  activePlayer = null;
  document.onfullscreenchange = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.body.classList.remove('night');
  if (appData.errors.length) return renderErrors();

  const route = parseHash();
  const today = localDate(new Date());
  const gate = profileGate(appData.profiles, store.deviceToday(), store.pinned(), today);

  if (!route.profile || (gate.kind === 'auto' && route.profile !== gate.profileId)) {
    if (gate.kind === 'auto') return replace({ profile: gate.profileId });
    return renderProfiles(gate.allowed);
  }

  const profile = appData.profiles.find((p) => p.id === route.profile);
  if (!profile || (gate.kind === 'choose' && !gate.allowed.has(profile.id))) return replace({});
  store.saveDeviceToday({ date: today, profileId: profile.id });
  setAccent(profile.color);

  const configured = profile.collections.flatMap((id) => appData.collections.get(id) ?? []);
  const byId = new Map(configured.map((c) => [c.config.id, c]));
  const available = orderCollectionIds([...byId.keys()], store.settings()).map((id) => byId.get(id)!);
  const shown = new Set(visibleCollectionIds(available.map((c) => c.config.id), store.settings()));
  const collections = available.filter((c) => shown.has(c.config.id));
  const showPicker = gate.kind === 'choose';

  const home: Route = collections.length > 1 || showPicker ? { profile: profile.id } : { profile: profile.id, collection: collections[0]?.config.id };
  if (route.settings) return renderSettings(profile, available, home);
  if (route.install) return renderInstall(home);
  if (route.history) return renderHistory(profile);

  if (!route.collection) {
    if (collections.length === 1) return replace({ profile: profile.id, collection: collections[0]!.config.id });
    return renderCollections(profile, collections, showPicker);
  }

  const collection = collections.find((c) => c.config.id === route.collection);
  if (!collection) return replace({ profile: profile.id });
  const listRoute: Route = { profile: profile.id, collection: collection.config.id };
  const listParent: Route | null = collections.length > 1 || showPicker ? { profile: profile.id } : null;

  if (route.today) return renderTodayDone(profile, collection, listRoute);
  if (route.video) return renderPlayer(profile, collection, route.video, listRoute);
  renderCollection(profile, collection, route.group, listParent);
}

function renderErrors(): void {
  app.innerHTML = `<main class="screen"><div class="bar"><h1>설정을 확인해 주세요</h1></div>
    <pre class="errors">${esc(appData.errors.join('\n'))}</pre></main>`;
}

function renderProfiles(allowed: Set<string>): void {
  setAccent(appData.profiles[0]?.color ?? '#4C8BF5');
  app.innerHTML = `<main class="screen"><h1 class="visually-hidden">누가 볼까요?</h1>
    <div class="profiles">${appData.profiles
      .map((p) => {
        const open = allowed.has(p.id);
        return `<button class="profile" data-profile="${esc(p.id)}" style="--accent:${esc(p.color)}"
          aria-label="${esc(p.name)}"${open ? '' : ' aria-disabled="true"'}>
          <span class="dot" aria-hidden="true"></span><span class="name">${esc(p.name)}</span></button>`;
      })
      .join('')}</div>${staleNote()}</main>`;
  app.querySelectorAll<HTMLButtonElement>('.profile').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') !== 'true') go({ profile: b.dataset.profile! });
    }),
  );
}

function renderCollections(profile: Profile, collections: Collection[], showBack: boolean): void {
  if (showBack) onBack = () => backTo({});
  const settings = store.settings();
  const views = new Map(collections.map((c) => [c.config.id, collectionView(profile, c)]));
  app.innerHTML = `<main class="screen"><div class="bar">${showBack ? backButton() : ''}<h1>${esc(homeTitle(profile.name, settings))}</h1>${gearButton()}</div>
    ${offlineNotice()}
    ${settings?.homeContinue === false ? '' : homeContinueHtml(collections, views)}
    <nav class="tiles" aria-label="컬렉션">${collections
      .map((c) => {
        const cover = c.config.coverVideoId ?? c.data.groups[0]?.videos[0]?.id ?? '';
        // A character with a video in progress shows how far it got, like the cards inside.
        const view = views.get(c.config.id)!;
        const bar = view.resume && view.highlight ? progressBar(startPosition(view.progress, view.highlight), view.highlight.durationSec) : '';
        return `<button class="tile" data-collection="${esc(c.config.id)}" aria-label="${esc(c.config.displayName)}">
          ${thumb(cover, c.config.displayName.slice(0, 1), bar, true)}<span class="label">${esc(c.config.displayName)}</span></button>`;
      })
      .join('')}</nav>${installHint()}${staleNote()}</main>`;
  bindBack();
  bindGear(profile.id);
  bindInstallHint(profile.id);
  app.querySelectorAll<HTMLButtonElement>('.tile').forEach((b) =>
    b.addEventListener('click', () => go({ profile: profile.id, collection: b.dataset.collection! })),
  );
  app.querySelector<HTMLButtonElement>('[data-continue]')?.addEventListener('click', (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    go({ profile: profile.id, collection: b.dataset.continue!, video: b.dataset.video! });
  });
}

/**
 * The home screen's 이어 보기: what the most recently watched character would offer on its own screen
 * (O3b, or the resumable episode after the daily limit). Hidden until something was watched.
 */
function homeContinueHtml(collections: Collection[], views: Map<string, CollectionView>): string {
  const id = mostRecentCollection(collections.map((c) => ({ id: c.config.id, lastAt: progressRecency(views.get(c.config.id)!.progress) })));
  const c = collections.find((x) => x.config.id === id);
  const view = c && views.get(c.config.id);
  const v = view?.highlight;
  if (!c || !view || !v) return '';
  const group = c.config.groups.find((g) => g.id === v.group)?.label ?? '';
  const at = view.resume ? startPosition(view.progress, v) : 0;
  const what = view.resume ? '이어 보기' : '다음 편';
  const when = view.resume ? `${duration(at)}부터` : duration(v.durationSec);
  return `<button class="hero home-continue" data-continue="${esc(c.config.id)}" data-video="${esc(v.id)}"
      aria-label="${what}: ${esc(c.config.displayName)} ${esc(group)} ${v.order}편 ${esc(v.displayTitle)}">
    ${thumb(v.id, String(v.order), `<span class="play" aria-hidden="true">${icon('play', 48)}</span>${progressBar(at, v.durationSec)}`, true)}
    <div><div class="chip">${icon(view.resume ? 'again' : 'play', 20)}${what}</div><div class="title">${esc(v.displayTitle)}</div>
      <div class="sub">${esc(c.config.displayName)} · ${esc(group)} ${v.order}편 · ${when}</div></div>
  </button>`;
}

interface CollectionView {
  progress: CollectionProgress;
  today: TodayState;
  limited: boolean;
  /** The card that gets the ▶ highlight: what to continue or watch next (O3b), or the resumable episode after the limit (R7). */
  highlight: VideoRecord | null;
  /** The highlight continues from a saved position. */
  resume: boolean;
}

function collectionView(profile: Profile, c: Collection): CollectionView {
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

function heroHtml(view: CollectionView, first: VideoRecord | undefined, groupLabels: Map<string, string>): string {
  const next = view.highlight;
  if (next) {
    const label = groupLabels.get(next.group) ?? '';
    const at = view.resume ? startPosition(view.progress, next) : 0;
    const what = view.resume ? '이어 보기' : '오늘 볼 영상';
    const when = view.resume ? `${duration(at)}부터 / ${duration(next.durationSec)}` : duration(next.durationSec);
    return `<button class="hero" data-video="${esc(next.id)}" aria-label="${what}: ${esc(label)} ${next.order}편 ${esc(next.displayTitle)}">
      ${thumb(next.id, String(next.order), `<span class="play" aria-hidden="true">${icon('play', 48)}</span>${progressBar(at, next.durationSec)}`, true)}
      <div>${view.resume ? `<div class="chip">${icon('again', 20)}이어 보기</div>` : ''}<div class="title">${esc(next.displayTitle)}</div><div class="sub">${esc(label)} · ${next.order}편 · ${when}</div></div>
    </button>`;
  }
  if (view.limited) {
    // Daily limit reached: the hero becomes the moon and leads to the "that's all for today" screen (D9).
    return `<button class="hero night" data-action="today" aria-label="오늘은 여기까지">
      <div class="moon-wrap" aria-hidden="true">${icon('moon', 96)}</div>
      <div><div class="title">오늘은 여기까지</div><div class="sub">내일 또 만나요</div></div>
    </button>`;
  }
  if (!first) return '';
  // Everything watched: celebrate, and offer to start over from the first episode (D10).
  return `<button class="hero done" data-video="${esc(first.id)}" aria-label="다 봤어요. 처음부터 다시 보기">
    ${thumb(first.id, '1', `<span class="play" aria-hidden="true">${icon('again', 48)}</span><span class="badge state done" aria-hidden="true">${icon('check', 24)}</span>`, true)}
    <div><div class="title" aria-hidden="true">${icon('check', 40)}</div><div class="sub">처음부터 다시 보기</div></div>
  </button>`;
}

/** A thin bar showing how far a video got, like a resume marker. Empty when it starts from the beginning. */
function progressBar(at: number, total: number): string {
  if (at <= 0 || total <= 0) return '';
  const pct = Math.min(100, Math.max(2, Math.round((at / total) * 100)));
  return `<span class="resume-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
}

function cardHtml(v: VideoRecord, view: CollectionView): string {
  const watched = v.id in view.progress.watched;
  const failed = v.id in view.progress.failed;
  const isNext = view.highlight?.id === v.id;
  const locked = view.limited && !isNext;
  const state = locked
    ? `<span class="badge state locked" aria-hidden="true">${icon('moon', 24)}</span>`
    : watched
      ? `<span class="badge state done" aria-hidden="true">${icon('check', 24)}</span>`
      : failed
        ? `<span class="badge state failed" aria-hidden="true">${icon('warning', 24)}</span>`
        : '';
  const status = locked
    ? ', 오늘은 여기까지'
    : watched
      ? ', 봤어요'
      : failed
        ? ', 지금은 볼 수 없어요'
        : isNext
          ? ', 다음에 볼 영상'
          : '';
  const cls = ['card', isNext ? 'next' : '', failed ? 'failed' : '', locked ? 'locked' : ''].filter(Boolean).join(' ');
  return `<button class="${cls}" data-video="${esc(v.id)}" tabindex="-1" aria-label="${v.order}편 ${esc(v.displayTitle)}${status}">
    ${thumb(v.id, String(v.order), `<span class="badge num" aria-hidden="true">${v.order}</span><span class="badge len" aria-hidden="true">${duration(v.durationSec)}</span>${state}${locked ? '' : progressBar(startPosition(view.progress, v), v.durationSec)}`)}
    <span class="title" aria-hidden="true">${esc(v.displayTitle)}</span></button>`;
}

function renderCollection(profile: Profile, c: Collection, groupParam: string | undefined, parent: Route | null): void {
  const view = collectionView(profile, c);
  const startGroup = profile.startGroup?.[c.config.id];
  const groupLabels = new Map(c.config.groups.map((g) => [g.id, g.label]));
  const groups = c.data.groups.filter((g) => g.videos.length > 0);
  const selected =
    groups.find((g) => g.id === groupParam)?.id ??
    view.highlight?.group ??
    initialGroup(seriesOnly(c.data, c.config), view.progress, startGroup) ??
    groups[0]?.id ??
    '';
  const current = groups.find((g) => g.id === selected);
  const base: Route = { profile: profile.id, collection: c.config.id };

  if (parent) onBack = () => backTo(parent);
  const firstEpisode = seriesOnly(c.data, c.config).groups[0]?.videos[0];
  app.innerHTML = `<main class="screen"><div class="bar">${parent ? backButton() : ''}<h1>${esc(c.config.displayName)}</h1>${parent ? '' : gearButton()}</div>
    ${offlineNotice()}
    ${heroHtml(view, firstEpisode, groupLabels)}
    <div class="tabs" role="tablist" aria-label="${esc(c.config.groupLabel)}">${groups
      .map((g, i) => {
        const on = g.id === selected;
        const label = groupLabels.get(g.id) ?? g.id;
        return `<button class="tab" role="tab" id="tab-${esc(g.id)}" aria-controls="grid" aria-selected="${on}" tabindex="${on ? 0 : -1}"
          data-group="${esc(g.id)}" aria-label="${esc(label)}">
          ${thumb(g.videos[0]!.id, String(i + 1), `<span class="badge num" aria-hidden="true">${i + 1}</span>`)}
          <span class="label" aria-hidden="true">${esc(label)}</span></button>`;
      })
      .join('')}</div>
    <section class="grid" id="grid" role="tabpanel" aria-labelledby="tab-${esc(selected)}">${(current?.videos ?? [])
      .map((v) => cardHtml(v, view))
      .join('')}</section>${parent ? '' : installHint()}${staleNote()}</main>`;

  bindBack();
  if (!parent) {
    bindGear(profile.id);
    bindInstallHint(profile.id);
  }
  app.querySelectorAll<HTMLButtonElement>('[data-video]').forEach((b) =>
    b.addEventListener('click', () => go({ ...base, video: b.dataset.video! })),
  );
  app.querySelector('[data-action="today"]')?.addEventListener('click', () => go({ ...base, today: true }));
  app.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      // Switching tabs replaces history so the back button leaves the collection instead of cycling tabs.
      history.replaceState(history.state, '', href({ ...base, group: b.dataset.group! }));
      render();
      app.querySelector<HTMLButtonElement>(`.tab[data-group="${CSS.escape(b.dataset.group!)}"]`)?.focus();
    }),
  );
  setupGridKeys();
}

/** Roving tabindex: one card is tabbable, arrow keys move between cards (groundwork for TV remotes). */
function setupGridKeys(): void {
  const grid = app.querySelector<HTMLElement>('.grid');
  if (!grid) return;
  const cards = [...grid.querySelectorAll<HTMLButtonElement>('.card')];
  if (cards.length === 0) return;
  const start = cards.find((c) => c.classList.contains('next')) ?? cards[0]!;
  start.tabIndex = 0;
  grid.addEventListener('keydown', (e) => {
    const i = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (step === undefined) return;
    const target = cards[i + step];
    if (!target) return;
    e.preventDefault();
    cards[i]!.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  });
}

// ---------- player (SPEC §8 P1-P4) ----------

function upNextCardHtml(u: UpNext, groupLabels: Map<string, string>): string {
  if (u.kind === 'limit') {
    return `<button class="upnext night" data-action="today" aria-label="오늘은 여기까지">${icon('moon', 56)}</button>`;
  }
  if (u.kind === 'done') {
    return `<button class="upnext done" data-action="list" aria-label="다 봤어요. 목록으로">${icon('check', 56)}</button>`;
  }
  const v = u.video;
  const label = u.newGroup ? groupLabels.get(v.group) ?? '' : '';
  return `<button class="upnext" data-next="${esc(v.id)}" aria-label="다음 화: ${label ? `${esc(label)} ` : ''}${v.order}편 ${esc(v.displayTitle)}">
    ${thumb(v.id, String(v.order), `<span class="play" aria-hidden="true">${icon('play', 32)}</span>${label ? `<span class="badge group" aria-hidden="true">${esc(label)}</span>` : ''}`, true)}
    <span class="title" aria-hidden="true">${v.order}. ${esc(v.displayTitle)}</span></button>`;
}

function renderPlayer(profile: Profile, c: Collection, videoId: string, listRoute: Route): void {
  const video = viewingOrder(c.data).find((v) => v.id === videoId);
  if (!video) return replace(listRoute);
  const date = localDate(new Date());
  let today = store.today(profile.id, date);
  const limits = limitsFor(profile);
  if (!canStart(today, limits, video.id)) return replace({ ...listRoute, today: true });
  let progress = store.progress(profile.id, c.config.id);
  let history = withToday(store.history(profile.id), today, collectionOfVideo);
  const groupLabels = new Map(c.config.groups.map((g) => [g.id, g.label]));
  // Free groups (compilations, clips) play on inside their own tab; series groups walk the episodes.
  const scope = upNextScope(c.data, c.config, video);
  const start = startPosition(progress, video);

  onBack = () => backTo(listRoute);
  app.innerHTML = `<main class="screen player-screen">
    <div class="bar">${backButton()}<h1>${esc(video.displayTitle)}</h1>
      <button class="big-toggle" data-action="big" aria-label="크게 보기" aria-pressed="false">${icon('maximize', 32)}</button></div>
    <div class="stage">
      <div class="video-wrap"><div id="yt"></div><div class="overlay" hidden></div></div>
      <div class="upnext-slot" aria-live="polite"></div>
      <button class="big-exit" data-action="big" aria-label="작게 보기">${icon('maximize', 28)}</button>
    </div>
    <p class="detect-off" hidden>감지 꺼짐</p>
  </main>`;
  bindBack();

  const main = app.querySelector<HTMLElement>('.player-screen')!;
  const overlay = app.querySelector<HTMLElement>('.overlay')!;
  const slot = app.querySelector<HTMLElement>('.upnext-slot')!;
  let shownUpNext = '';
  let player: PlayerHandle | null = null;

  const save = () => {
    store.saveToday(profile.id, today);
    store.saveProgress(profile.id, c.config.id, progress);
    store.saveHistory(profile.id, history);
  };
  const openNext = (id: string) => replace({ ...listRoute, video: id });
  const openToday = () => replace({ ...listRoute, today: true });

  // "크게 보기": real fullscreen on our own stage (so the up-next card and overlays stay visible) plus a
  // landscape lock, which Android only allows while fullscreen. iPhone has no element fullscreen and keeps
  // the CSS-only big mode.
  const stage = app.querySelector<HTMLElement>('.stage')!;
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  const setBig = (on: boolean) => {
    main.classList.toggle('big', on);
    app.querySelector('.big-toggle')?.setAttribute('aria-pressed', String(on));
  };
  const enterBig = async () => {
    setBig(true);
    if (!stage.requestFullscreen) return;
    try {
      await stage.requestFullscreen({ navigationUI: 'hide' });
      await orientation.lock?.('landscape');
    } catch {
      // fullscreen or the lock was refused: the CSS big mode still applies
    }
  };
  const exitBig = () => {
    setBig(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  // Leaving fullscreen with the system back gesture also leaves big mode.
  document.onfullscreenchange = () => {
    if (!document.fullscreenElement && main.classList.contains('big')) setBig(false);
  };
  app.querySelectorAll<HTMLButtonElement>('[data-action="big"]').forEach((b) =>
    b.addEventListener('click', () => (main.classList.contains('big') ? exitBig() : void enterBig())),
  );

  const bindOverlayActions = (root: HTMLElement) => {
    root.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', (e) =>
      openNext((e.currentTarget as HTMLButtonElement).dataset.next!),
    );
    root.querySelector('[data-action="today"]')?.addEventListener('click', openToday);
    root.querySelector('[data-action="list"]')?.addEventListener('click', () => backTo(listRoute));
  };

  const showOverlay = (inner: string) => {
    slot.innerHTML = '';
    shownUpNext = '';
    overlay.innerHTML = `<div class="overlay-body">${inner}</div>`;
    overlay.hidden = false;
    bindOverlayActions(overlay);
    overlay.querySelector<HTMLButtonElement>('button')?.focus();
  };

  const listButton = `<button class="overlay-small" data-action="list" aria-label="목록으로">${icon('back', 32)}</button>`;

  createPlayer(app.querySelector<HTMLElement>('#yt')!, video.id, {
    onPlaying(delta, current, total) {
      today = recordPlay(today, video.id, delta);
      const r = recordProgress(progress, video, delta, Date.now());
      progress = recordPosition(r.progress, video.id, current);
      history = recordHistory(history, today.date, c.config.id, video.id, delta);
      if (r.completed) {
        today = recordFinished(today, video.id);
        history = recordHistoryDone(history, today.date, video.id);
      }
      if (shouldCutAtLimit(today, limits, video)) {
        // A compilation stops at the limit and continues tomorrow from this position.
        player?.stop();
        today = recordStopped(today, video.id);
        save();
        return openToday();
      }
      save();
      const remaining = total - current;
      if (total > 0 && remaining <= UP_NEXT_SEC && overlay.hidden) {
        const u = upNext(scope, video, today, limits, remaining);
        const key = u.kind === 'next' ? u.video.id : u.kind;
        if (key !== shownUpNext) {
          shownUpNext = key;
          slot.innerHTML = upNextCardHtml(u, groupLabels);
          bindOverlayActions(slot);
        }
      }
    },
    onEnded() {
      today = recordFinished(today, video.id);
      history = recordHistoryDone(history, today.date, video.id);
      progress = recordPosition(progress, video.id, null);
      save();
      const u = upNext(scope, video, today, limits, 0);
      if (u.kind === 'limit') return openToday();
      showOverlay(`${upNextCardHtml(u, groupLabels)}${listButton}`);
    },
    onError() {
      // P4: never counted, never marked watched; remembered so O3 skips it on this device.
      progress = recordFailed(progress, video.id, Date.now());
      store.saveProgress(profile.id, c.config.id, progress);
      const u = upNext(scope, video, today, limits, 0);
      showOverlay(`<div class="overlay-icon" aria-hidden="true">${icon('unplug', 64)}</div>
        <span class="visually-hidden">이 영상은 지금 볼 수 없어요</span>
        ${u.kind === 'next' && canStart(today, limits, u.video.id) ? upNextCardHtml(u, groupLabels) : ''}${listButton}`);
    },
    onForeignVideo(resumeAt) {
      // P2 + design D8: offer to continue the episode the child was watching.
      showOverlay(`<button class="upnext resume" data-action="resume" aria-label="이어보기: ${esc(video.displayTitle)}">
          ${thumb(video.id, String(video.order), `<span class="play" aria-hidden="true">${icon('play', 32)}</span>`, true)}</button>${listButton}`);
      overlay.querySelector('[data-action="resume"]')?.addEventListener('click', () => {
        overlay.hidden = true;
        overlay.innerHTML = '';
        player?.load(video.id, Math.max(0, resumeAt - 2));
      });
    },
    onDetectionUnavailable() {
      app.querySelector<HTMLElement>('.detect-off')!.hidden = false;
    },
  }, start)
    .then((p) => {
      if (activePlayer === null && app.contains(main)) {
        player = p;
        activePlayer = p;
      } else p.destroy();
    })
    .catch(() => {
      showOverlay(`<div class="overlay-icon" aria-hidden="true">${icon('offline', 64)}</div>
        <span class="visually-hidden">플레이어를 불러오지 못했어요</span>
        <button class="overlay-small" data-action="reload" aria-label="다시 시도">${icon('again', 32)}</button>${listButton}`);
      overlay.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload());
    });
}

// ---------- that's all for today (design D9) ----------

function renderTodayDone(profile: Profile, c: Collection, listRoute: Route): void {
  const today = store.today(profile.id, localDate(new Date()));
  if (!limitReached(today, limitsFor(profile))) return replace(listRoute);
  const all = viewingOrder(c.data);
  const seen = today.started.flatMap((id) => all.find((v) => v.id === id) ?? []);
  const progress = store.progress(profile.id, c.config.id);
  // A compilation cut off by the limit is what continues tomorrow; otherwise the next episode.
  const cut = [...today.stopped].reverse().flatMap((id) => all.find((v) => v.id === id) ?? [])[0];
  const tomorrow = cut ?? heroPick(c.data, c.config, progress, profile.startGroup?.[c.config.id])?.video ?? null;
  const resumable = resumableAfterLimit(today);

  document.body.classList.add('night');
  onBack = () => backTo(listRoute);
  app.innerHTML = `<main class="screen night-screen"><div class="bar">${backButton()}<h1 class="visually-hidden">오늘은 여기까지</h1></div>
    <div class="moon" aria-hidden="true">${icon('moon', 120)}</div>
    <section aria-label="오늘 본 영상" class="today-row">${seen
      .map((v) => thumb(v.id, String(v.order), `<span class="badge state done" aria-hidden="true">${icon('check', 24)}</span>`, true))
      .join('')}</section>
    ${
      tomorrow
        ? `<section aria-label="내일 볼 영상" class="tomorrow">${thumb(tomorrow.id, String(tomorrow.order), `<span class="lock" aria-hidden="true">${icon('lock', 40)}</span>`, true)}</section>`
        : ''
    }
    ${
      resumable
        ? `<p class="resume-note"><button class="hero-mini" data-video="${esc(resumable)}" aria-label="보던 영상 마저 보기">${icon('play', 32)}</button></p>`
        : ''
    }
  </main>`;
  bindBack();
  app.querySelector<HTMLButtonElement>('[data-video]')?.addEventListener('click', (e) =>
    replace({ ...listRoute, video: (e.currentTarget as HTMLButtonElement).dataset.video! }),
  );
}

// ---------- parent settings (device-local, long-press gear) ----------

function limitsFor(profile: Profile): Limits {
  return effectiveLimits(profile, store.settings());
}

const HOLD_MS = 2000;

function gearButton(): string {
  return `<button class="gear" data-action="gear" aria-label="설정 (2초 동안 누르기)">${icon('settings', 28)}<span class="hold" aria-hidden="true"></span></button>`;
}

/** Opens settings only after a 2 s press (pointer or Enter/Space), so a child's tap does nothing. */
function bindGear(profileId: string): void {
  const gear = app.querySelector<HTMLButtonElement>('[data-action="gear"]');
  if (!gear) return;
  let timer = 0;
  const start = () => {
    window.clearTimeout(timer);
    gear.classList.add('holding');
    timer = window.setTimeout(() => {
      gear.classList.remove('holding');
      go({ profile: profileId, settings: true });
    }, HOLD_MS);
  };
  const cancel = () => {
    window.clearTimeout(timer);
    gear.classList.remove('holding');
  };
  gear.addEventListener('pointerdown', start);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) gear.addEventListener(ev, cancel);
  gear.addEventListener('contextmenu', (e) => e.preventDefault());
  gear.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      start();
    }
  });
  gear.addEventListener('keyup', cancel);
}

const LIMIT_STEP: Record<LimitMode, { step: number; min: number; max: number; unit: string; initial: number }> = {
  none: { step: 0, min: 0, max: 0, unit: '', initial: 0 },
  minutes: { step: 10, min: 10, max: 240, unit: '분', initial: 60 },
  episodes: { step: 1, min: 1, max: 20, unit: '편', initial: 3 },
};

function renderSettings(profile: Profile, available: Collection[], home: Route): void {
  const current: DeviceSettings = store.settings() ?? {
    limit:
      profile.dailyMinutes !== null
        ? { mode: 'minutes', value: profile.dailyMinutes }
        : profile.dailyEpisodes !== null
          ? { mode: 'episodes', value: profile.dailyEpisodes }
          : { mode: 'none', value: 0 },
  };
  const today = store.today(profile.id, localDate(new Date()));
  const { mode, value } = current.limit;
  const spec = LIMIT_STEP[mode];
  const hidden = new Set(current.hidden ?? []);
  const shownCount = available.filter((c) => !hidden.has(c.config.id)).length;
  const watchedMin = Math.floor(today.seconds / 60);
  // Show today's use against the limit when there is one, so a parent sees how much is left.
  const todayUsage =
    mode === 'minutes'
      ? `본 시간 <b>${watchedMin}분</b> / 하루 ${value}분`
      : mode === 'episodes'
        ? `시작한 영상 <b>${today.started.length}편</b> / 하루 ${value}편 · 본 시간 ${watchedMin}분`
        : `본 시간 <b>${watchedMin}분</b> · 시작한 영상 ${today.started.length}편`;
  const option = (m: LimitMode, label: string) =>
    `<button class="choice" role="radio" aria-checked="${m === mode}" data-mode="${m}">${label}</button>`;

  onBack = () => backTo(home);
  app.innerHTML = `<main class="screen settings"><div class="bar">${backButton()}<h1>설정</h1></div>
    <section class="panel" aria-labelledby="limit-title">
      <h2 id="limit-title">하루 시청 제한</h2>
      <div class="choices" role="radiogroup" aria-labelledby="limit-title">
        ${option('none', '제한 없음')}${option('minutes', '시간으로')}${option('episodes', '편 수로')}
      </div>
      ${
        mode === 'none'
          ? ''
          : `<div class="stepper">
          <button class="step" data-step="-1" aria-label="줄이기"${value <= spec.min ? ' disabled' : ''}>−</button>
          <output class="value" aria-live="polite">하루 ${value}${spec.unit}</output>
          <button class="step" data-step="1" aria-label="늘리기"${value >= spec.max ? ' disabled' : ''}>+</button>
        </div>
        <p class="hint">${mode === 'minutes' ? '15분이 넘는 모음집은 시간이 되면 멈추고, 다음 날 그 자리부터 이어 봐요.' : '보던 편은 끝까지 보고, 다음 편부터 막혀요.'}</p>`
      }
    </section>
    <section class="panel" aria-labelledby="today-title">
      <h2 id="today-title">오늘</h2>
      <p class="today-usage">${todayUsage}</p>
      <div class="row-actions">
        <button class="secondary" data-action="history">시청 기록 보기</button>
        ${mode === 'none' ? '' : '<button class="secondary" data-action="reset-today">오늘 기록 초기화 (한 번 더 보기)</button>'}
      </div>
    </section>
    <section class="panel" aria-labelledby="shown-title">
      <h2 id="shown-title">보여 줄 캐릭터</h2>
      <div class="shown-list">${available
        .map((c, i) => {
          const on = !hidden.has(c.config.id);
          const cover = c.config.coverVideoId ?? c.data.groups[0]?.videos[0]?.id ?? '';
          // The last visible one cannot be turned off: the home screen must never be empty.
          const locked = on && shownCount === 1;
          const id = esc(c.config.id);
          const name = esc(c.config.displayName);
          return `<div class="shown-row"><button class="shown" role="switch" aria-checked="${on}" data-shown="${id}"${locked ? ' aria-disabled="true"' : ''}>
            <img src="${thumbUrl(cover)}" alt="" width="96" height="72" loading="lazy">
            <span class="name">${name}</span><span class="state">${on ? '보여요' : '숨김'}</span></button>
            <button class="move" data-move="-1" data-id="${id}" aria-label="${name} 위로"${i === 0 ? ' disabled' : ''}>${icon('up', 28)}</button>
            <button class="move" data-move="1" data-id="${id}" aria-label="${name} 아래로"${i === available.length - 1 ? ' disabled' : ''}>${icon('down', 28)}</button></div>`;
        })
        .join('')}</div>
      <p class="hint">누르면 보이기·숨기기, 화살표로 홈 화면 순서를 바꿔요. 끈 캐릭터는 아이 화면에서 사라지고, 본 기록은 그대로 남아요.</p>
    </section>
    <section class="panel" aria-labelledby="home-title-h">
      <h2 id="home-title-h">홈 화면</h2>
      <button class="shown switch" role="switch" aria-checked="${current.homeContinue !== false}" data-action="home-continue">
        <span class="name">맨 위 "이어 보기" 칸</span><span class="state">${current.homeContinue !== false ? '켜짐' : '꺼짐'}</span></button>
      <p class="hint">가장 최근에 본 캐릭터에서 보던 영상(다 봤으면 다음 편)을 한 번에 이어 봐요.</p>
      <h3 id="name-title">이름</h3>
      <form class="title-form" data-action="title">
        <input id="home-title" name="title" maxlength="${TITLE_MAX}" value="${esc(homeTitle(profile.name, current))}" aria-labelledby="name-title" autocomplete="off">
        <button class="secondary" type="submit">저장</button>
      </form>
      <p class="hint" id="title-msg" role="status"></p>
    </section>
    <section class="panel" aria-labelledby="sync-title">
      <h2 id="sync-title">다른 기기와 맞추기</h2>
      <p class="hint">이 화면의 설정(하루 제한, 보여 줄 캐릭터와 순서, 홈 화면)을 다른 기기에 그대로 적용해요. 본 기록은 옮겨지지 않아요.</p>
      <button class="secondary" data-action="share-settings">이 설정 보내기</button>
      <details class="paste">
        <summary id="paste-title">받은 링크 붙여넣기</summary>
        <form class="title-form" data-action="paste-settings">
          <input id="settings-link" name="link" placeholder="https://moabom.hgko.dev/?settings=…" aria-labelledby="paste-title" autocomplete="off" inputmode="url">
          <button class="secondary" type="submit">적용</button>
        </form>
        <p class="hint" id="paste-msg" role="status">아이폰 홈 화면 앱은 링크를 눌러도 적용되지 않아요. 링크를 길게 눌러 복사한 뒤 여기에 붙여넣어 주세요.</p>
      </details>
    </section>
    <section class="panel" aria-labelledby="install-title">
      <h2 id="install-title">홈 화면에 추가</h2>
      ${
        currentPlatform() === 'standalone'
          ? `<p class="installed">${icon('check', 24)}앱으로 열려 있어요</p>`
          : '<button class="secondary" data-action="install-guide">설치 방법 보기</button>'
      }
    </section>
    <p class="hint">설정은 기기마다 따로 저장돼요. 다른 기기에도 같게 하려면 "이 설정 보내기"를 쓰세요.</p>
  </main>`;
  bindBack();
  app.querySelector('[data-action="install-guide"]')?.addEventListener('click', () => go({ profile: profile.id, install: true }));

  // render() rather than renderSettings(): hiding collections can change where "home" is.
  const save = (next: DeviceSettings) => {
    store.saveSettings(next);
    render();
    app.querySelector<HTMLElement>(`[data-mode="${next.limit.mode}"]`)?.focus();
  };
  app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      const m = b.dataset.mode as LimitMode;
      if (m !== mode) save({ ...current, limit: { mode: m, value: LIMIT_STEP[m].initial } });
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = Math.min(spec.max, Math.max(spec.min, value + Number(b.dataset.step) * spec.step));
      store.saveSettings({ ...current, limit: { mode, value: next } });
      render();
      app.querySelector<HTMLButtonElement>(`[data-step="${b.dataset.step}"]`)?.focus();
    }),
  );
  app.querySelector('[data-action="reset-today"]')?.addEventListener('click', () => {
    if (!confirm('오늘 본 시간과 편 수를 0으로 되돌릴까요?')) return;
    store.saveToday(profile.id, { date: today.date, started: [], finished: [], playedToday: {}, seconds: 0, stopped: [] });
    render();
  });
  app.querySelectorAll<HTMLButtonElement>('[data-shown]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      const id = b.dataset.shown!;
      const next = new Set(hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      store.saveSettings({ ...current, hidden: [...next] });
      render();
      app.querySelector<HTMLElement>(`[data-shown="${CSS.escape(id)}"]`)?.focus();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id!;
      const step = Number(b.dataset.move) as -1 | 1;
      store.saveSettings({ ...current, order: moveCollection(available.map((c) => c.config.id), id, step) });
      render();
      // Keep focus on the moved item's arrow; fall back to the other arrow at the ends.
      const same = app.querySelector<HTMLButtonElement>(`[data-move="${step}"][data-id="${CSS.escape(id)}"]`);
      (same && !same.disabled ? same : app.querySelector<HTMLButtonElement>(`[data-move="${-step}"][data-id="${CSS.escape(id)}"]`))?.focus();
    }),
  );
  app.querySelector<HTMLButtonElement>('[data-action="share-settings"]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const url = settingsLink(location.origin, location.pathname, current);
    try {
      if (navigator.share) {
        await navigator.share({ title: '모아봄 설정', text: '이 링크를 열면 모아봄 설정이 그 기기에 적용돼요.', url });
        return;
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return; // closed the share sheet
    }
    try {
      await navigator.clipboard.writeText(url);
      b.textContent = '링크를 복사했어요. 카톡 등으로 보내 주세요';
    } catch {
      prompt('이 링크를 복사해서 보내 주세요', url);
    }
  });
  app.querySelector<HTMLFormElement>('[data-action="paste-settings"]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = app.querySelector<HTMLInputElement>('#settings-link')!.value;
    const incoming = settingsFromText(text);
    if (!incoming) {
      app.querySelector('#paste-msg')!.textContent = '설정 링크가 아니에요. "이 설정 보내기"로 만든 링크를 붙여넣어 주세요.';
      return;
    }
    if (applyIncomingSettings(incoming)) render();
  });
  app.querySelector('[data-action="history"]')?.addEventListener('click', () => go({ profile: profile.id, history: true }));
  app.querySelector('[data-action="home-continue"]')?.addEventListener('click', () => {
    store.saveSettings({ ...current, homeContinue: current.homeContinue === false });
    render();
    app.querySelector<HTMLElement>('[data-action="home-continue"]')?.focus();
  });
  // The title saves on 저장 and also when the field loses focus, so leaving without pressing 저장 keeps it.
  const titleInput = app.querySelector<HTMLInputElement>('#home-title')!;
  const saveTitle = () => {
    const title = titleInput.value.trim().slice(0, TITLE_MAX);
    const latest = store.settings() ?? current;
    store.saveSettings({ ...latest, title: title === profile.name ? undefined : title || undefined });
    titleInput.value = title || profile.name;
    app.querySelector('#title-msg')!.textContent = `"${titleInput.value}"(으)로 저장했어요.`;
  };
  titleInput.addEventListener('change', saveTitle);
  app.querySelector<HTMLFormElement>('[data-action="title"]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveTitle();
    titleInput.blur();
  });
}

// ---------- viewing history (H) ----------

let videoCollections: Map<string, string> | null = null;

/** Which collection a video belongs to (for back-filling history from today's counters). */
function collectionOfVideo(videoId: string): string | null {
  videoCollections ??= new Map(
    [...appData.collections.values()].flatMap((c) => viewingOrder(c.data).map((v) => [v.id, c.config.id] as const)),
  );
  return videoCollections.get(videoId) ?? null;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function dayLabel(date: string, today: string): string {
  if (date === today) return '오늘';
  if (date === shiftDate(today, -1)) return '어제';
  const [y, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일 (${WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]})`;
}

function playedTime(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 1) return sec > 0 ? '1분 미만' : '0분';
  const h = Math.floor(min / 60);
  return h ? `${h}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`;
}

/** H3: the last 7 days on this device — minutes per day, then what was watched each day. */
function renderHistory(profile: Profile): void {
  const today = localDate(new Date());
  const merged = withToday(store.history(profile.id), store.today(profile.id, today), collectionOfVideo);
  store.saveHistory(profile.id, merged);
  const days = recentDays(merged, today, 7);
  const total = days.reduce((n, d) => n + d.seconds, 0);
  const max = Math.max(...days.map((d) => d.seconds), 1);
  const find = (cid: string, vid: string) => {
    const c = appData.collections.get(cid);
    return { c, v: c && viewingOrder(c.data).find((x) => x.id === vid) };
  };

  onBack = () => backTo({ profile: profile.id, settings: true });
  app.innerHTML = `<main class="screen settings history"><div class="bar">${backButton()}<h1>시청 기록</h1></div>
    <section class="panel" aria-labelledby="week-title">
      <h2 id="week-title">최근 7일 · ${playedTime(total)}</h2>
      <ul class="week">${days
        .map(
          (d) => `<li><span class="day">${dayLabel(d.date, today)}</span>
          <span class="meter" aria-hidden="true"><span style="width:${Math.round((d.seconds / max) * 100)}%"></span></span>
          <span class="time">${playedTime(d.seconds)}</span></li>`,
        )
        .join('')}</ul>
    </section>
    ${days
      .filter((d) => d.videos.length)
      .map(
        (d) => `<section class="panel" aria-label="${dayLabel(d.date, today)}">
      <h2>${dayLabel(d.date, today)} <span class="muted">· ${playedTime(d.seconds)}</span></h2>
      <ul class="watched">${d.videos
        .map(([vid, e]) => {
          const { c, v } = find(e.c, vid);
          const title = v?.displayTitle ?? '지금은 목록에 없는 영상';
          const group = v ? c!.config.groups.find((g) => g.id === v.group)?.label ?? '' : '';
          return `<li>${thumb(vid, v ? String(v.order) : '?', e.done ? `<span class="badge state done" aria-hidden="true">${icon('check', 20)}</span>` : '')}
            <div><div class="title">${esc(title)}</div>
            <div class="sub">${esc(c?.config.displayName ?? '')}${group ? ` · ${esc(group)} ${v!.order}편` : ''} · ${playedTime(e.sec)}${e.done ? ' · 다 봤어요' : ''}</div></div></li>`;
        })
        .join('')}</ul>
    </section>`,
      )
      .join('') || '<p class="hint">아직 기록이 없어요. 영상을 보면 여기에 날짜별로 쌓여요.</p>'}
    <p class="hint">이 기기에서 본 것만 보여요. 최근 ${HISTORY_DAYS}일까지 보관해요.</p>
  </main>`;
  bindBack();
}

// ---------- home-screen install ----------

/** A small dismissible card on the home screen of a phone/tablet browser tab (not shown once installed). */
function installHint(): string {
  const p = currentPlatform();
  if (p === 'standalone' || p === 'desktop' || store.installHintDismissed()) return '';
  const action = canPromptInstall()
    ? `<button class="primary" data-action="install-now">${icon('download', 24)}앱 설치</button>`
    : '<button class="secondary" data-action="install-guide">방법 보기</button>';
  return `<aside class="install-hint" aria-label="홈 화면에 추가">
    <p>홈 화면에 추가하면 앱처럼 전체 화면으로 열려요</p>
    <button class="close" data-action="install-dismiss" aria-label="닫기">${icon('close', 24)}</button>${action}</aside>`;
}

function bindInstallHint(profileId: string): void {
  app.querySelector('[data-action="install-now"]')?.addEventListener('click', () => void promptInstall().then(render));
  app.querySelector('[data-action="install-guide"]')?.addEventListener('click', () => go({ profile: profileId, install: true }));
  app.querySelector('[data-action="install-dismiss"]')?.addEventListener('click', () => {
    store.dismissInstallHint();
    app.querySelector('.install-hint')?.remove();
  });
}

function stepsHtml(steps: readonly string[]): string {
  return `<ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
}

function renderInstall(home: Route): void {
  const platform = currentPlatform();
  const appUrl = location.origin + location.pathname;
  const installButton = canPromptInstall()
    ? `<button class="primary" data-action="install-now">${icon('download', 24)}지금 바로 설치하기</button>
       <p class="hint">버튼이 안 되면 아래 순서대로 해 주세요.</p>`
    : '';
  const already = '<p class="hint">"이미 설치되어 있다"고 나오면 홈 화면이나 앱 목록에서 "모아봄"을 찾아 주세요.</p>';
  const android = `${installButton}${stepsHtml(STEPS.android)}${already}`;
  const ios = stepsHtml(STEPS.ios);
  const copy = `<button class="secondary" data-action="copy-url">주소 복사</button><p class="url">${esc(appUrl)}</p>`;

  let body: string;
  switch (platform) {
    case 'standalone':
      body = `<p class="installed">${icon('check', 24)}이미 앱으로 열려 있어요</p>`;
      break;
    case 'android':
      body = `<h2>Android · Chrome</h2>${android}`;
      break;
    case 'samsung':
      body = `<h2>삼성 인터넷</h2>${installButton}${stepsHtml(STEPS.samsung)}
        <h2>Chrome에서 열었다면</h2>${stepsHtml(STEPS.android)}${already}`;
      break;
    case 'ios-safari':
      body = `<h2>iPhone · iPad (Safari)</h2>${ios}`;
      break;
    case 'ios-other':
      body = `<h2>Safari로 열어 주세요</h2>
        <p>iPhone·iPad는 Safari에서 추가하는 게 가장 확실해요. 주소를 복사해 Safari에 붙여넣어 주세요.</p>${copy}
        <h2>Safari에서 연 다음</h2>${ios}`;
      break;
    case 'desktop':
      body = `<p>태블릿이나 휴대폰에서 아래 주소를 열고 이 안내를 따라 주세요.</p>${copy}
        <h2>Android · Chrome</h2>${stepsHtml(STEPS.android)}
        <h2>iPhone · iPad (Safari)</h2>${ios}`;
      break;
  }

  onBack = () => backTo(home);
  app.innerHTML = `<main class="screen settings install"><div class="bar">${backButton()}<h1>홈 화면에 추가</h1></div>
    <section class="panel">${body}</section></main>`;
  bindBack();
  app.querySelector('[data-action="install-now"]')?.addEventListener('click', () => void promptInstall().then(render));
  app.querySelector<HTMLButtonElement>('[data-action="copy-url"]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(appUrl);
      b.textContent = '복사했어요';
    } catch {
      b.textContent = '아래 주소를 길게 눌러 복사해 주세요';
    }
  });
}

function bindBack(): void {
  app.querySelector('[data-action="back"]')?.addEventListener('click', () => onBack?.());
  app.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload());
}

render();
