import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import type { Profile, VideoRecord } from './config.ts';
import { loadAppData, type Collection } from './data.ts';
import { icon } from './icons.ts';
import { initialGroup, isStale, localDate, nextToWatch, profileGate } from './rules.ts';
import { browserKV, createStore, type CollectionProgress } from './storage.ts';

const app = document.getElementById('app')!;
const appData = loadAppData();
const store = createStore(browserKV());

// ---------- routing: #/p/{profile}/c/{collection}/v/{video}?g={group} ----------

interface Route {
  profile?: string;
  collection?: string;
  video?: string;
  group?: string;
}

function parseHash(): Route {
  const [path = '', query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const route: Route = {};
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [key, value] = [parts[i], parts[i + 1]];
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
  if (r.profile && r.collection) h += `/c/${encodeURIComponent(r.collection)}`;
  if (r.profile && r.collection && r.video) h += `/v/${encodeURIComponent(r.video)}`;
  if (r.group && !r.video) h += `?g=${encodeURIComponent(r.group)}`;
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
window.addEventListener('online', render);
window.addEventListener('offline', render);

// A device opened once with ?profile=<id> stays on that profile (SPEC L5).
{
  const pin = new URLSearchParams(location.search).get('profile');
  if (pin && appData.profiles.some((p) => p.id === pin)) store.savePinned(pin);
  if (pin !== null) history.replaceState(history.state, '', location.pathname + location.hash);
}

// ---------- helpers ----------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function duration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
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

function render(): void {
  onBack = null;
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

  const collections = profile.collections.flatMap((id) => appData.collections.get(id) ?? []);
  const showPicker = gate.kind === 'choose';

  if (!route.collection) {
    if (collections.length === 1) return replace({ profile: profile.id, collection: collections[0]!.config.id });
    return renderCollections(profile, collections, showPicker);
  }

  const collection = collections.find((c) => c.config.id === route.collection);
  if (!collection) return replace({ profile: profile.id });
  const parentOfCollection: Route = collections.length > 1 || showPicker ? { profile: profile.id } : {};

  if (route.video) return renderPlayerPlaceholder(profile, collection, route.video);
  renderCollection(profile, collection, route.group, collections.length > 1 || showPicker ? parentOfCollection : null);
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
  app.innerHTML = `<main class="screen"><div class="bar">${showBack ? backButton() : ''}<h1>${esc(profile.name)}</h1></div>
    ${offlineNotice()}
    <nav class="tiles" aria-label="컬렉션">${collections
      .map((c) => {
        const cover = c.config.coverVideoId ?? c.data.groups[0]?.videos[0]?.id ?? '';
        return `<button class="tile" data-collection="${esc(c.config.id)}" aria-label="${esc(c.config.displayName)}">
          ${thumb(cover, c.config.displayName.slice(0, 1), '', true)}<span class="label">${esc(c.config.displayName)}</span></button>`;
      })
      .join('')}</nav>${staleNote()}</main>`;
  bindBack();
  app.querySelectorAll<HTMLButtonElement>('.tile').forEach((b) =>
    b.addEventListener('click', () => go({ profile: profile.id, collection: b.dataset.collection! })),
  );
}

function heroHtml(next: VideoRecord | null, first: VideoRecord | undefined, groupLabels: Map<string, string>): string {
  if (next) {
    const label = groupLabels.get(next.group) ?? '';
    return `<button class="hero" data-video="${esc(next.id)}" aria-label="오늘 볼 영상: ${esc(label)} ${next.order}편 ${esc(next.displayTitle)}">
      ${thumb(next.id, String(next.order), `<span class="play" aria-hidden="true">${icon('play', 48)}</span>`, true)}
      <div><div class="title">${esc(next.displayTitle)}</div><div class="sub">${esc(label)} · ${next.order}편 · ${duration(next.durationSec)}</div></div>
    </button>`;
  }
  if (!first) return '';
  // Everything watched: celebrate, and offer to start over from the first episode (design D10).
  return `<button class="hero done" data-video="${esc(first.id)}" aria-label="다 봤어요. 처음부터 다시 보기">
    ${thumb(first.id, '1', `<span class="play" aria-hidden="true">${icon('again', 48)}</span><span class="badge state done" aria-hidden="true">${icon('check', 24)}</span>`, true)}
    <div><div class="title" aria-hidden="true">${icon('check', 40)}</div><div class="sub">처음부터 다시 보기</div></div>
  </button>`;
}

function cardHtml(v: VideoRecord, p: CollectionProgress, next: VideoRecord | null): string {
  const watched = v.id in p.watched;
  const failed = v.id in p.failed;
  const isNext = next?.id === v.id;
  const state = watched
    ? `<span class="badge state done" aria-hidden="true">${icon('check', 24)}</span>`
    : failed
      ? `<span class="badge state failed" aria-hidden="true">${icon('warning', 24)}</span>`
      : '';
  const status = watched ? ', 봤어요' : failed ? ', 지금은 볼 수 없어요' : isNext ? ', 다음에 볼 영상' : '';
  return `<button class="card${isNext ? ' next' : ''}${failed ? ' failed' : ''}" data-video="${esc(v.id)}" tabindex="-1"
      aria-label="${v.order}편 ${esc(v.displayTitle)}${status}">
    ${thumb(v.id, String(v.order), `<span class="badge num" aria-hidden="true">${v.order}</span><span class="badge len" aria-hidden="true">${duration(v.durationSec)}</span>${state}`)}
    <span class="title" aria-hidden="true">${esc(v.displayTitle)}</span></button>`;
}

function renderCollection(profile: Profile, c: Collection, groupParam: string | undefined, parent: Route | null): void {
  const p = store.progress(profile.id, c.config.id);
  const startGroup = profile.startGroup?.[c.config.id];
  const next = nextToWatch(c.data, p, startGroup);
  const groupLabels = new Map(c.config.groups.map((g) => [g.id, g.label]));
  const groups = c.data.groups.filter((g) => g.videos.length > 0);
  const selected =
    groups.find((g) => g.id === groupParam)?.id ?? initialGroup(c.data, p, startGroup) ?? groups[0]?.id ?? '';
  const current = groups.find((g) => g.id === selected);

  if (parent) onBack = () => backTo(parent);
  app.innerHTML = `<main class="screen"><div class="bar">${parent ? backButton() : ''}<h1>${esc(c.config.displayName)}</h1></div>
    ${offlineNotice()}
    ${heroHtml(next, groups[0]?.videos[0], groupLabels)}
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
      .map((v) => cardHtml(v, p, next))
      .join('')}</section>${staleNote()}</main>`;

  bindBack();
  const open = (videoId: string) => go({ profile: profile.id, collection: c.config.id, video: videoId });
  app.querySelectorAll<HTMLButtonElement>('[data-video]').forEach((b) => b.addEventListener('click', () => open(b.dataset.video!)));
  app.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      // Switching tabs replaces history so the back button leaves the collection instead of cycling tabs.
      history.replaceState(history.state, '', href({ profile: profile.id, collection: c.config.id, group: b.dataset.group! }));
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

function renderPlayerPlaceholder(profile: Profile, c: Collection, videoId: string): void {
  // M4 replaces this with the IFrame player (SPEC §8 P1-P4).
  const v = c.data.groups.flatMap((g) => g.videos).find((x) => x.id === videoId);
  onBack = () => backTo({ profile: profile.id, collection: c.config.id });
  app.innerHTML = `<main class="screen"><div class="bar">${backButton()}<h1>${esc(v?.displayTitle ?? '')}</h1></div>
    ${v ? thumb(v.id, String(v.order), '', true) : ''}
    <p class="notice">플레이어는 M4에서 연결됩니다.</p></main>`;
  bindBack();
}

function bindBack(): void {
  app.querySelector('[data-action="back"]')?.addEventListener('click', () => onBack?.());
  app.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload());
}

render();
