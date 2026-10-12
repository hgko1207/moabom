import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import type { Profile, VideoRecord } from './config.ts';
import { loadAppData, type Collection } from './data.ts';
import { icon } from './icons.ts';
import { createPlayer, type PlayerHandle } from './player.ts';
import {
  canStart,
  initialGroup,
  isStale,
  limitReached,
  localDate,
  nextToWatch,
  profileGate,
  recordFailed,
  recordFinished,
  recordPlay,
  recordProgress,
  resumableAfterLimit,
  UP_NEXT_SEC,
  upNext,
  viewingOrder,
  type UpNext,
} from './rules.ts';
import { browserKV, createStore, type CollectionProgress, type TodayState } from './storage.ts';

const app = document.getElementById('app')!;
const appData = loadAppData();
const store = createStore(browserKV());

// ---------- routing: #/p/{profile}/c/{collection}[/v/{video} | /today][?g={group}] ----------

interface Route {
  profile?: string;
  collection?: string;
  video?: string;
  today?: boolean;
  group?: string;
}

function parseHash(): Route {
  const [path = '', query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const route: Route = {};
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (key === 'today') {
      route.today = true;
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

  const collections = profile.collections.flatMap((id) => appData.collections.get(id) ?? []);
  const showPicker = gate.kind === 'choose';

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

interface CollectionView {
  progress: CollectionProgress;
  today: TodayState;
  limited: boolean;
  /** The card that gets the ▶ highlight: next to watch, or the resumable episode after the limit (R7). */
  highlight: VideoRecord | null;
}

function collectionView(profile: Profile, c: Collection): CollectionView {
  const progress = store.progress(profile.id, c.config.id);
  const today = store.today(profile.id, localDate(new Date()));
  const limited = limitReached(today, profile);
  const all = viewingOrder(c.data);
  const resumable = resumableAfterLimit(today);
  const highlight = limited
    ? (all.find((v) => v.id === resumable) ?? null)
    : nextToWatch(c.data, progress, profile.startGroup?.[c.config.id]);
  return { progress, today, limited, highlight };
}

function heroHtml(view: CollectionView, first: VideoRecord | undefined, groupLabels: Map<string, string>): string {
  const next = view.highlight;
  if (next) {
    const label = groupLabels.get(next.group) ?? '';
    return `<button class="hero" data-video="${esc(next.id)}" aria-label="오늘 볼 영상: ${esc(label)} ${next.order}편 ${esc(next.displayTitle)}">
      ${thumb(next.id, String(next.order), `<span class="play" aria-hidden="true">${icon('play', 48)}</span>`, true)}
      <div><div class="title">${esc(next.displayTitle)}</div><div class="sub">${esc(label)} · ${next.order}편 · ${duration(next.durationSec)}</div></div>
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
    ${thumb(v.id, String(v.order), `<span class="badge num" aria-hidden="true">${v.order}</span><span class="badge len" aria-hidden="true">${duration(v.durationSec)}</span>${state}`)}
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
    initialGroup(c.data, view.progress, startGroup) ??
    groups[0]?.id ??
    '';
  const current = groups.find((g) => g.id === selected);
  const base: Route = { profile: profile.id, collection: c.config.id };

  if (parent) onBack = () => backTo(parent);
  app.innerHTML = `<main class="screen"><div class="bar">${parent ? backButton() : ''}<h1>${esc(c.config.displayName)}</h1></div>
    ${offlineNotice()}
    ${heroHtml(view, groups[0]?.videos[0], groupLabels)}
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
      .join('')}</section>${staleNote()}</main>`;

  bindBack();
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
  if (!canStart(today, profile, video.id)) return replace({ ...listRoute, today: true });
  let progress = store.progress(profile.id, c.config.id);
  const groupLabels = new Map(c.config.groups.map((g) => [g.id, g.label]));

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
  };
  const openNext = (id: string) => replace({ ...listRoute, video: id });
  const openToday = () => replace({ ...listRoute, today: true });

  app.querySelectorAll<HTMLButtonElement>('[data-action="big"]').forEach((b) =>
    b.addEventListener('click', () => {
      const on = main.classList.toggle('big');
      app.querySelector('.big-toggle')?.setAttribute('aria-pressed', String(on));
    }),
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
      progress = r.progress;
      if (r.completed) today = recordFinished(today, video.id);
      save();
      const remaining = total - current;
      if (total > 0 && remaining <= UP_NEXT_SEC && overlay.hidden) {
        const u = upNext(c.data, video, today, profile, remaining);
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
      save();
      const u = upNext(c.data, video, today, profile, 0);
      if (u.kind === 'limit') return openToday();
      showOverlay(`${upNextCardHtml(u, groupLabels)}${listButton}`);
    },
    onError() {
      // P4: never counted, never marked watched; remembered so O3 skips it on this device.
      progress = recordFailed(progress, video.id, Date.now());
      store.saveProgress(profile.id, c.config.id, progress);
      const u = upNext(c.data, video, today, profile, 0);
      showOverlay(`<div class="overlay-icon" aria-hidden="true">${icon('unplug', 64)}</div>
        <span class="visually-hidden">이 영상은 지금 볼 수 없어요</span>
        ${u.kind === 'next' && canStart(today, profile, u.video.id) ? upNextCardHtml(u, groupLabels) : ''}${listButton}`);
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
  })
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
  if (!limitReached(today, profile)) return replace(listRoute);
  const all = viewingOrder(c.data);
  const seen = today.started.flatMap((id) => all.find((v) => v.id === id) ?? []);
  const progress = store.progress(profile.id, c.config.id);
  const tomorrow = nextToWatch(c.data, progress, profile.startGroup?.[c.config.id]);
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

function bindBack(): void {
  app.querySelector('[data-action="back"]')?.addEventListener('click', () => onBack?.());
  app.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload());
}

render();
