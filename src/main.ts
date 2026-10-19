import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import type { Profile, VideoRecord } from './config.ts';
import type { Collection } from './data.ts';
import { icon } from './icons.ts';
import { SETTINGS_PARAM, settingsFromText } from './share.ts';
import { onInstallChange } from './install.ts';
import { createPlayer, type PlayerHandle } from './player.ts';
import {
  canStart,
  heroPick,
  initialGroup,
  limitReached,
  localDate,
  orderCollectionIds,
  profileGate,
  recordFailed,
  recordFinished,
  recordHistory,
  recordHistoryDone,
  recordPlay,
  recordPosition,
  recordProgress,
  recordStopped,
  resumableAfterLimit,
  seriesOnly,
  shouldCutAtLimit,
  startPosition,
  UP_NEXT_SEC,
  upNext,
  upNextScope,
  viewingOrder,
  visibleCollectionIds,
  withToday,
  type UpNext,
} from './rules.ts';
import { renderCollections, renderProfiles } from './screens/home.ts';
import { renderHistory, renderInstall, renderSettings } from './screens/settings.ts';
import {
  app,
  appData,
  applyIncomingSettings,
  backButton,
  backTo,
  bindBack,
  bindGear,
  bindInstallHint,
  collectionOfVideo,
  collectionView,
  duration,
  esc,
  gearButton,
  go,
  href,
  installHint,
  limitsFor,
  offlineNotice,
  parseHash,
  progressBar,
  replace,
  setAccent,
  setBack,
  setRenderer,
  staleNote,
  store,
  thumb,
  type CollectionView,
  type Route,
} from './ui.ts';

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

let activePlayer: PlayerHandle | null = null;

function render(): void {
  setBack(null);
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

  if (parent) setBack(() => backTo(parent));
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

  setBack(() => backTo(listRoute));
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
  setBack(() => backTo(listRoute));
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

setRenderer(render);
render();
