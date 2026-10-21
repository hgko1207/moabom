// The player screen (SPEC §8 P1-P4, design P2-1, P2-2, P2-4, P2-5).
import type { Profile, VideoRecord } from '../config.ts';
import type { Collection } from '../data.ts';
import { icon } from '../icons.ts';
import { moon } from '../art.ts';
import { createPlayer, type PlayerHandle } from '../player.ts';
import {
  canReplay,
  canStart,
  episodeLabel,
  errorStep,
  localDate,
  nextInOrder,
  playerButtonOn,
  playerShieldOn,
  NO_ERRORS,
  prevInOrder,
  recordFailed,
  recordFinished,
  recordHistory,
  recordHistoryDone,
  recordPlay,
  recordPosition,
  recordProgress,
  recordStopped,
  shouldAutoResume,
  shouldCutAtLimit,
  startPosition,
  upNext,
  upNextScope,
  viewingOrder,
  withToday,
  type ErrorState,
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
  onLeave,
  replace,
  setAccent,
  setActivePlayer,
  setBack,
  store,
  thumb,
  type Route,
} from '../ui.ts';

/** Seconds before an unplayable video moves on to the next episode (P2-5). */
const SKIP_AFTER_MS = 3000;

/**
 * Errors that may be the network's fault wait here until a later video plays (P2-5). It lives across the player
 * screens that auto-advance opens one after another, and is dropped once the child leaves the player.
 */
let errors: ErrorState = NO_ERRORS;

function upNextCardHtml(u: UpNext, c: Collection): string {
  if (u.kind === 'limit') {
    return `<button class="upnext night" data-action="today" aria-label="오늘은 여기까지">${moon(56)}</button>`;
  }
  if (u.kind === 'done') {
    return `<button class="upnext done" data-action="list" aria-label="다 봤어요. 목록으로">${icon('check', 56)}</button>`;
  }
  const v = u.video;
  const label = u.newGroup ? c.config.groups.find((g) => g.id === v.group)?.label ?? '' : '';
  return `<button class="upnext" data-next="${esc(v.id)}" aria-label="다음 화: ${esc(episodeLabel(c.config, v))} ${esc(v.displayTitle)}">
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
  // Free groups (compilations, clips) play on inside their own tab; series groups walk the episodes.
  const scope = upNextScope(c.data, c.config, video);
  const start = startPosition(progress, video);
  if (c.config.color) setAccent(c.config.color);

  // Player buttons show unless a parent turned one off in settings (P2-1).
  const buttons = store.settings()?.player ?? {};
  const prev = playerButtonOn(buttons, 'prev') ? prevInOrder(scope, video.id) : null;
  const next = playerButtonOn(buttons, 'next') ? nextInOrder(scope, video.id) : null;
  // YouTube 버튼 막기: YouTube's controls are gone, so the app carries play/pause (and the tap layer below).
  const shield = playerShieldOn(buttons);
  const controls = [
    prev ? `<button class="control" data-go="${esc(prev.id)}" aria-label="이전 편">${icon('skip-back', 32)}</button>` : '',
    // The one filled control is play/pause, and only with 버튼 막기. 한 번 더 waits for the end of the video
    // (critique 2026-10-21): in the row it was the biggest target and reset the episode with one tap.
    shield ? `<button class="control fill" data-action="toggle-play" aria-label="일시정지">${icon('pause', 32)}</button>` : '',
    next ? `<button class="control" data-go="${esc(next.id)}" aria-label="다음 편">${icon('skip-forward', 32)}</button>` : '',
  ].join('');
  // Under the buttons (2026-10-21): what plays next, the same episode, setting and daily limit as the 다음 편
  // button; or, when today's limit ends with this episode, the moon, so the child knows well before the end.
  // This replaced the up-next card that popped up over or under the video 20 s before the end.
  const nextSlotHtml = (remainingSec: number): string => {
    if (upNext(scope, video, today, limits, remainingSec).kind === 'limit') {
      return `<p class="last-today">${moon(32)}<span>오늘은 이 편이 마지막이에요</span></p>`;
    }
    return next && canStart(today, limits, next.id)
      ? `<button class="next-preview" data-go="${esc(next.id)}" aria-label="다음에 볼 편: ${esc(episodeLabel(c.config, next))} ${esc(next.displayTitle)}">
      ${thumb(next.id, String(next.order))}<span class="next-text"><small>다음에 볼 편</small><b>${esc(episodeLabel(c.config, next))} · ${esc(next.displayTitle)}</b></span><span class="next-go" aria-hidden="true">${icon('play', 22)}</span></button>`
      : '';
  };
  let nextSlot = nextSlotHtml(Math.max(0, video.durationSec - start));

  setBack(() => backTo(listRoute));
  app.innerHTML = `<main class="screen player-screen">
    <div class="bar">${backButton()}
      <button class="big-toggle" data-action="big" aria-label="크게 보기" aria-pressed="false">${icon('maximize', 32)}</button></div>
    <div class="stage">
      <div class="video-wrap"><div id="yt"></div>${shield ? '<div class="shield" data-action="toggle-play" aria-hidden="true"></div>' : ''}<div class="overlay" hidden></div></div>
      <button class="big-exit" data-action="big" aria-label="작게 보기">${icon('maximize', 28)}</button>
    </div>
    <div class="player-info">
      <p class="episode-label">${esc(episodeLabel(c.config, video))}</p>
      <h1 class="episode-title">${esc(video.displayTitle)}</h1>
    </div>
    ${controls ? `<div class="controls" role="group" aria-label="재생 버튼">${controls}</div>` : ''}
    <div class="next-slot" aria-live="polite">${nextSlot}</div>
    <p class="detect-off" hidden>감지 꺼짐</p>
  </main>`;
  bindBack();

  const main = app.querySelector<HTMLElement>('.player-screen')!;
  const overlay = app.querySelector<HTMLElement>('.overlay')!;
  let counted = false;
  let player: PlayerHandle | null = null;

  const save = () => {
    store.saveToday(profile.id, today);
    store.saveProgress(profile.id, c.config.id, progress);
    store.saveHistory(profile.id, history);
  };
  const openNext = (id: string) => replace({ ...listRoute, video: id });
  const openToday = () => replace({ ...listRoute, today: true });
  /** Next/previous episode and the error skip all go through the daily limit (L3). */
  const goTo = (target: VideoRecord | string) => {
    const id = typeof target === 'string' ? target : target.id;
    return canStart(today, limits, id) ? openNext(id) : openToday();
  };

  // Leaving the player for any other screen forgets errors still waiting for a verdict.
  onLeave(() => {
    if (!/\/v\//.test(location.hash)) errors = NO_ERRORS;
  });

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

  // Player buttons (P2-1).
  app.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.go!)));
  // Play/pause for 버튼 막기: the tap layer over the video and the button do the same thing.
  const playButton = app.querySelector<HTMLButtonElement>('button[data-action="toggle-play"]');
  const showPlaying = (playing: boolean) => {
    if (!playButton || playButton.dataset.playing === String(playing)) return;
    playButton.dataset.playing = String(playing);
    playButton.setAttribute('aria-label', playing ? '일시정지' : '재생');
    playButton.innerHTML = icon(playing ? 'pause' : 'play', 32);
  };
  app.querySelectorAll('[data-action="toggle-play"]').forEach((el) =>
    el.addEventListener('click', () => {
      if (!player) return;
      if (player.isPlaying()) {
        player.pause();
        showPlaying(false);
      } else {
        player.play();
        showPlaying(true);
      }
    }),
  );
  const replay = () => {
    // A same-day rewatch: no new episode is counted (L1), the minutes still are (L2).
    overlay.hidden = true;
    overlay.innerHTML = '';
    progress = recordPosition(progress, video.id, null);
    save();
    player?.restart();
  };
  /** 한 번 더 on the end overlay, when a parent left it on and today's limit still allows it. */
  const replayButton = () =>
    playerButtonOn(buttons, 'replay') && canReplay(today, limits)
      ? `<button class="overlay-small" data-action="replay" aria-label="한 번 더">${icon('again', 32)}</button>`
      : '';

  const bindOverlayActions = (root: HTMLElement) => {
    root.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', (e) =>
      openNext((e.currentTarget as HTMLButtonElement).dataset.next!),
    );
    root.querySelector('[data-action="today"]')?.addEventListener('click', openToday);
    root.querySelector('[data-action="replay"]')?.addEventListener('click', replay);
    root.querySelector('[data-action="list"]')?.addEventListener('click', () => backTo(listRoute));
  };

  const showOverlay = (inner: string) => {
    overlay.innerHTML = `<div class="overlay-body">${inner}</div>`;
    overlay.hidden = false;
    bindOverlayActions(overlay);
    overlay.querySelector<HTMLButtonElement>('button')?.focus();
  };

  const listButton = `<button class="overlay-small" data-action="list" aria-label="목록으로">${icon('back', 32)}</button>`;

  // Resume a video the OS paused while the page was briefly hidden (P2-4); never after a pause someone pressed.
  let lastPlayingAt = 0;
  let pausedAt: number | null = null;
  let hidden: { hiddenAt: number; playingWhenHidden: boolean } | null = null;
  let resumeCheck = 0;
  const onVisibility = () => {
    const now = Date.now();
    if (document.visibilityState === 'hidden') {
      hidden = { hiddenAt: now, playingWhenHidden: !!player?.isPlaying() || now - lastPlayingAt < 2000 };
      return;
    }
    const spell = hidden;
    hidden = null;
    if (!spell || !player || !shouldAutoResume({ ...spell, pausedAt, visibleAt: now })) return;
    player.play();
    // iOS may refuse to play without a tap: offer a big ▶ instead.
    window.clearTimeout(resumeCheck);
    resumeCheck = window.setTimeout(() => {
      if (player?.isPlaying() || !overlay.hidden) return;
      showOverlay(`<button class="upnext resume" data-action="resume" aria-label="계속 보기">
          ${thumb(video.id, String(video.order), `<span class="play" aria-hidden="true">${icon('play', 32)}</span>`, true)}</button>${listButton}`);
      overlay.querySelector('[data-action="resume"]')?.addEventListener('click', () => {
        overlay.hidden = true;
        overlay.innerHTML = '';
        player?.play();
      });
    }, 1000);
  };
  document.addEventListener('visibilitychange', onVisibility);
  let skipTimer = 0;
  onLeave(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearTimeout(resumeCheck);
    window.clearTimeout(skipTimer);
  });

  createPlayer(app.querySelector<HTMLElement>('#yt')!, video.id, {
    onPlaying(delta, current, total) {
      lastPlayingAt = Date.now();
      showPlaying(true);
      if (!counted) {
        counted = true;
        analytics.playStart(c.config.id);
        // A video plays: errors that waited for this were the videos' fault after all (P2-5).
        const settled = errorStep(errors, { kind: 'played' });
        errors = settled.state;
        for (const id of settled.markFailed) progress = recordFailed(progress, id, Date.now());
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
      // The episode can become today's last while it plays (counted after 10 s, or the minutes run low).
      const html = nextSlotHtml(total > 0 ? total - current : Math.max(0, video.durationSec - current));
      if (html !== nextSlot) {
        nextSlot = html;
        const box = app.querySelector<HTMLElement>('.next-slot');
        if (box) {
          box.innerHTML = html;
          box.querySelector<HTMLButtonElement>('[data-go]')?.addEventListener('click', (e) => goTo((e.currentTarget as HTMLButtonElement).dataset.go!));
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
      showOverlay(`${upNextCardHtml(u, c)}${replayButton()}${listButton}`);
    },
    onError(code) {
      // Never counted, never marked watched (P4). Removed or blocked videos are marked now; others wait (P2-5).
      analytics.videoError(video.id, code);
      const o = errorStep(errors, { kind: 'error', videoId: video.id, code, online: navigator.onLine });
      errors = o.state;
      for (const id of o.markFailed) progress = recordFailed(progress, id, Date.now());
      store.saveProgress(profile.id, c.config.id, progress);
      if (o.notice) {
        showOverlay(`<div class="overlay-icon" aria-hidden="true">${icon('offline', 64)}</div>
          <p class="overlay-text" role="status">인터넷 연결을 확인해 주세요</p>
          <button class="overlay-small" data-action="reload" aria-label="다시 시도">${icon('again', 32)}</button>${listButton}`);
        overlay.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload());
        return;
      }
      const u = upNext(scope, video, today, limits, 0);
      const skip = o.advance && u.kind === 'next' && canStart(today, limits, u.video.id);
      showOverlay(`<div class="overlay-icon" aria-hidden="true">${icon('unplug', 64)}</div>
        <span class="visually-hidden">이 영상은 지금 볼 수 없어요${skip ? '. 곧 다음 편으로 넘어가요' : ''}</span>
        ${u.kind === 'next' && canStart(today, limits, u.video.id) ? upNextCardHtml(u, c) : u.kind === 'limit' ? upNextCardHtml(u, c) : ''}${listButton}`);
      if (skip) skipTimer = window.setTimeout(() => goTo(u.video), SKIP_AFTER_MS);
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
    onPaused() {
      pausedAt = Date.now();
      showPlaying(false);
    },
  }, start, shield)
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
