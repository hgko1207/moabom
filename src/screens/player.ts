// The player screen (SPEC §8 P1-P4).
import type { Profile } from '../config.ts';
import type { Collection } from '../data.ts';
import { icon } from '../icons.ts';
import { createPlayer, type PlayerHandle } from '../player.ts';
import {
  canStart,
  localDate,
  recordFailed,
  recordFinished,
  recordHistory,
  recordHistoryDone,
  recordPlay,
  recordPosition,
  recordProgress,
  recordStopped,
  shouldCutAtLimit,
  startPosition,
  UP_NEXT_SEC,
  upNext,
  upNextScope,
  viewingOrder,
  withToday,
  type UpNext,
} from '../rules.ts';
import {
  activePlayer,
  analytics,
  app,
  backButton,
  backTo,
  bindBack,
  collectionOfVideo,
  esc,
  limitsFor,
  replace,
  setActivePlayer,
  setBack,
  store,
  thumb,
  type Route,
} from '../ui.ts';

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

export function renderPlayer(profile: Profile, c: Collection, videoId: string, listRoute: Route): void {
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
  let counted = false;
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
      if (!counted) {
        counted = true;
        analytics.playStart(c.config.id);
      }
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
    onError(code) {
      // P4: never counted, never marked watched; remembered so O3 skips it on this device.
      analytics.videoError(video.id, code);
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
      if (activePlayer() === null && app.contains(main)) {
        player = p;
        setActivePlayer(p);
      } else p.destroy();
    })
    .catch(() => {
      showOverlay(`<div class="overlay-icon" aria-hidden="true">${icon('offline', 64)}</div>
        <span class="visually-hidden">플레이어를 불러오지 못했어요</span>
        <button class="overlay-small" data-action="reload" aria-label="다시 시도">${icon('again', 32)}</button>${listButton}`);
      overlay.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload());
    });
}
