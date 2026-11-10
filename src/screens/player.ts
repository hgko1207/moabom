// The player screen (SPEC §8 P1-P4, design P2-1, P2-2, P2-4, P2-5).
import type { Profile, VideoRecord } from '../config.ts';
import type { Collection } from '../data.ts';
import { icon } from '../icons.ts';
import { moon } from '../art.ts';
import { createPlayer, type PlayerHandle } from '../player.ts';
import {
  COUNT_AFTER_SEC,
  canReplay,
  canStart,
  episodeLabel,
  errorStep,
  isRewatch,
  keepTail,
  limitReached,
  localDate,
  moreAfter,
  nextGrows,
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
  recordRewatch,
  recordStopped,
  shouldAutoResume,
  shouldCutAtLimit,
  startPosition,
  upNext,
  upNextAfterError,
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
  thumbUrl,
  type Route,
} from '../ui.ts';

/** Seconds before an unplayable video moves on to the next episode (P2-5). */
const SKIP_AFTER_MS = 3000;

/**
 * Errors that may be the network's fault wait here until a later video plays (P2-5). It lives across the player
 * screens that auto-advance opens one after another, and is dropped once the child leaves the player.
 */
let errors: ErrorState = NO_ERRORS;

/**
 * 크게 보기 carries over when the player opens another episode (2026-11-10: it fell back to the small page after
 * every 다음 편). Set just before that move and read once by the next player; main.ts keeps fullscreen meanwhile.
 */
let carryBig = false;
export const carriesBig = (): boolean => carryBig;

function upNextCardHtml(u: UpNext, c: Collection): string {
  if (u.kind === 'limit') {
    return `<button class="upnext night" data-action="today" aria-label="오늘은 여기까지">${moon(56)}</button>`;
  }
  if (u.kind === 'done') {
    return `<button class="upnext done" data-action="list" aria-label="다 봤어요. 목록으로">${icon('check', 56)}</button>`;
  }
  const v = u.video;
  const label = u.newGroup ? c.config.groups.find((g) => g.id === v.group)?.label ?? '' : '';
  return `<button class="upnext" data-next="${esc(v.id)}" aria-label="다음 편: ${esc(episodeLabel(c.config, v))} ${esc(v.displayTitle)}">
    ${thumb(v.id, String(v.order), `<span class="play" aria-hidden="true">${icon('play', 32)}</span>${label ? `<span class="badge group" aria-hidden="true">${esc(label)}</span>` : ''}`, true)}
    <span class="n-label" aria-hidden="true"><small>다음 편</small><b>${esc(episodeLabel(c.config, v))} ${esc(keepTail(v.displayTitle))}</b></span></button>`;
}

export function renderPlayer(profile: Profile, c: Collection, videoId: string, listRoute: Route): void {
  const video = viewingOrder(c.data).find((v) => v.id === videoId);
  const startBig = carryBig;
  carryBig = false;
  if (!video) return replace(listRoute);
  const date = localDate(new Date());
  let today = store.today(profile.id, date);
  const limits = limitsFor(profile);
  if (!canStart(today, limits, video.id)) return replace({ ...listRoute, today: true });
  let progress = store.progress(profile.id, c.config.id);
  let history = withToday(store.history(profile.id), today, collectionOfVideo);
  // Free groups (compilations, clips) play on inside their own tab; series groups walk the episodes.
  const scope = upNextScope(c.data, c.config, video);
  const start = startPosition(progress, video, limitReached(today, limits));
  // Seconds until this rewatch counts as one more episode (L1a); null when there is nothing left to count.
  let rewatchLeft = isRewatch(today, video.id, start) ? COUNT_AFTER_SEC : null;
  if (c.config.color) setAccent(c.config.color);

  // Player buttons show unless a parent turned one off in settings (P2-1).
  const buttons = store.settings()?.player ?? {};
  const prev = playerButtonOn(buttons, 'prev') ? prevInOrder(scope, video.id) : null;
  const next = playerButtonOn(buttons, 'next') ? nextInOrder(scope, video.id) : null;
  // YouTube 버튼 막기: YouTube's controls are gone and a clear layer over the video takes every tap (play/pause).
  const shield = playerShieldOn(buttons);
  // Under the title (redesign 2026-11-08): one quiet row, 이전 편 as an icon-only square and the next episode as its
  // picture, which grows in the last 30 s. No pause button: the video itself takes taps. When today's limit ends
  // with this episode the moon takes the row, and 이전 편 goes too: pressed mid-episode it would end the day.
  const isLastToday = (remainingSec: number): boolean =>
    upNext(scope, video, today, limits, remainingSec, rewatchLeft !== null).kind === 'limit';
  const nextLabel = next ? `${episodeLabel(c.config, next)} ${keepTail(next.displayTitle)}` : '';
  const nextOpen = (): boolean => !!next && canStart(today, limits, next.id);
  // 이전 편 is the previous episode's picture with a back mark (critique 2026-11-08), and says 이전 편 like the next
  // one says 다음 편 (2026-11-10): under the picture on the page, on it in 크게 보기.
  const prevButton = (cls: 'n-prev' | 'b-prev'): string => {
    if (!prev) return '';
    const mark = `<span class="p-go" aria-hidden="true">${icon('skip-back', 20)}</span>`;
    const inner =
      cls === 'n-prev'
        ? `${thumb(prev.id, String(prev.order), mark)}<span class="n-label" aria-hidden="true"><small>이전 편</small></span>`
        : thumb(prev.id, String(prev.order), `${mark}<span class="b-tag" aria-hidden="true">이전 편</span>`);
    return `<button class="${cls}" data-go="${esc(prev.id)}" aria-label="이전 편: ${esc(`${episodeLabel(c.config, prev)} ${prev.displayTitle}`)}">${inner}</button>`;
  };
  const rowHtml = (remainingSec: number): string => {
    if (isLastToday(remainingSec)) {
      return `<p class="n-last" role="status"><span class="n-moon" aria-hidden="true">${moon(40)}</span><span>오늘은 이 편이 마지막이에요</span></p>`;
    }
    const back = prev ? prevButton('n-prev') : '';
    if (!next || !nextOpen()) return back;
    const grown = nextGrows(remainingSec);
    return `${back}<button class="n-next${grown ? ' grown' : ''}" data-go="${esc(next.id)}" aria-label="다음 편: ${esc(nextLabel)}">
      ${thumb(next.id, String(next.order), `<span class="n-go" aria-hidden="true">${icon('play', 24)}</span>`)}
      <span class="n-label"><small>${grown ? '곧 다음 편' : '다음 편'}</small><b>${esc(nextLabel)}</b></span></button>`;
  };
  // 크게 보기 keeps the same two buttons, in the black band beside the picture, never over it. The next picture is
  // the bigger one and carries the play mark; in the last 30 s it lights up and says 곧 다음 편, as on the page.
  const bigBarHtml = (remainingSec: number): string => {
    if (isLastToday(remainingSec)) return '';
    const back = prev ? prevButton('b-prev') : '';
    const grown = nextGrows(remainingSec);
    const ahead =
      next && nextOpen()
        ? `<button class="b-next${grown ? ' grown' : ''}" data-go="${esc(next.id)}" aria-label="다음 편: ${esc(nextLabel)}">${thumb(next.id, String(next.order), `<span class="n-go" aria-hidden="true">${icon('play', 16)}</span><span class="b-tag" aria-hidden="true">${grown ? '곧 다음 편' : '다음 편'}</span>`)}</button>`
        : '';
    return back + ahead;
  };
  const remainingAtStart = Math.max(0, video.durationSec - start);
  let row = rowHtml(remainingAtStart);

  setBack(() => backTo(listRoute));
  app.innerHTML = `<main class="screen player-screen">
    <div class="bar">${backButton()}<p class="show">${esc(c.config.displayName)}</p>
      <button class="big-toggle" data-action="big" aria-label="크게 보기" aria-pressed="false">${icon('maximize', 28)}<span>크게</span></button></div>
    <div class="stage">
      <div class="video-wrap"><div id="yt"></div>${
        shield
          ? `<button class="shield" data-action="toggle-play" aria-label="일시정지"></button><span class="paused-mark" aria-hidden="true">${icon('play', 44)}</span>`
          : ''
      }<div class="overlay" hidden></div></div>
      <div class="big-bar" role="group" aria-label="재생 버튼">${bigBarHtml(remainingAtStart)}</div>
      <button class="big-exit" data-action="big" aria-label="작게 보기">${icon('minimize', 24)}<span>작게</span></button>
    </div>
    <div class="player-info">
      <p class="episode-label">${esc(episodeLabel(c.config, video))}</p>
      <h1 class="episode-title">${esc(keepTail(video.displayTitle))}</h1>
    </div>
    <div class="nrow" role="group" aria-label="재생 버튼" aria-live="polite">${row}</div>
    <div class="after"></div>
    <p class="detect-off" hidden>이 기기에서는 다른 영상으로 넘어가도 막지 못해요</p>
  </main>`;
  bindBack();

  const main = app.querySelector<HTMLElement>('.player-screen')!;
  const overlay = app.querySelector<HTMLElement>('.overlay')!;
  const after = app.querySelector<HTMLElement>('.after')!;
  // Upright, the page under the video is free, so the choice sits there at full size and the overlay only covers
  // the video. On its side, or in big mode, the video fills the screen and the choice stays on it.
  const upright = window.matchMedia('(orientation: portrait)');
  const seatChoice = () => {
    const body = main.querySelector('.overlay-body');
    if (body) (upright.matches && !main.classList.contains('big') ? after : overlay).append(body);
  };
  upright.addEventListener('change', seatChoice);
  onLeave(() => upright.removeEventListener('change', seatChoice));
  let counted = false;
  let player: PlayerHandle | null = null;

  const save = () => {
    store.saveToday(profile.id, today);
    store.saveProgress(profile.id, c.config.id, progress);
    store.saveHistory(profile.id, history);
  };
  const openNext = (id: string) => {
    carryBig = main.classList.contains('big');
    replace({ ...listRoute, video: id });
  };
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

  // "크게 보기": real fullscreen on the whole page (the stage covers it, so the up-next card and overlays stay visible;
  // the page outlives a move to the next episode, the stage does not) plus a landscape lock, which Android only allows
  // while fullscreen. iPhone has no element fullscreen and keeps the CSS-only big mode, turned sideways when upright.
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  const setBig = (on: boolean) => {
    main.classList.toggle('big', on);
    app.querySelector('.big-toggle')?.setAttribute('aria-pressed', String(on));
    seatChoice();
  };
  const enterBig = async () => {
    setBig(true);
    const page = document.documentElement;
    if (!page.requestFullscreen || document.fullscreenElement) return;
    try {
      await page.requestFullscreen({ navigationUI: 'hide' });
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
  if (startBig) setBig(true);

  // Player buttons (P2-1).
  const bindGo = (root: ParentNode) =>
    root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.go!)));
  bindGo(app);
  // Play/pause for 버튼 막기: the layer over the video takes the tap; while paused a big ▶ says "tap to go on".
  const playButton = app.querySelector<HTMLButtonElement>('button[data-action="toggle-play"]');
  const wrap = app.querySelector<HTMLElement>('.video-wrap')!;
  const showPlaying = (playing: boolean) => {
    if (!playButton || playButton.dataset.playing === String(playing)) return;
    playButton.dataset.playing = String(playing);
    playButton.setAttribute('aria-label', playing ? '일시정지' : '재생');
    wrap.classList.toggle('paused', !playing);
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
    // A same-day rewatch: one more episode after 10 s (L1a), and the minutes count as always (L2).
    rewatchLeft = isRewatch(today, video.id, 0) ? COUNT_AFTER_SEC : null;
    hideOverlay();
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
    root.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.pick!)));
  };

  /**
   * The end screen (P3, 2026-11-08): the next episode big, then a few more from its tab so a child can pick another
   * without going back to the list, and 한 번 더 when a parent left it on.
   */
  const endChoiceHtml = (u: UpNext): string => {
    if (u.kind !== 'next') return `${upNextCardHtml(u, c)}${replayButton()}`;
    const more = moreAfter(scope, u.video.id, 3).filter((v) => canStart(today, limits, v.id));
    const group = c.config.groups.find((g) => g.id === u.video.group)?.label ?? '';
    const pick = (v: VideoRecord) => {
      const label = episodeLabel(c.config, v);
      return `<button class="end-pick" data-pick="${esc(v.id)}" aria-label="${esc(label)} ${esc(v.displayTitle)}">
        ${thumb(v.id, String(v.order))}<span class="n-label"><small>${esc(label)}</small><b>${esc(keepTail(v.displayTitle))}</b></span></button>`;
    };
    const list = more.length
      ? `<section class="end-more" aria-labelledby="end-more-title"><div class="end-head"><h2 id="end-more-title">${esc(group ? `${group}에서 고르기` : '더 고르기')}</h2>
          <button class="text-button" data-action="list">${esc(group ? `${group} 전체 보기` : '전체 보기')}</button></div>${more.map(pick).join('')}</section>`
      : '';
    return `${upNextCardHtml(u, c)}${replayButton()}${list}`;
  };

  const hideOverlay = () => {
    overlay.hidden = true;
    overlay.replaceChildren();
    after.replaceChildren();
  };

  const showOverlay = (inner: string): HTMLElement => {
    hideOverlay();
    const body = document.createElement('div');
    body.className = 'overlay-body';
    body.innerHTML = inner;
    overlay.append(body);
    overlay.style.setProperty('--finished', `url("${thumbUrl(video.id)}")`);
    overlay.hidden = false;
    seatChoice();
    bindOverlayActions(body);
    body.querySelector<HTMLButtonElement>('button')?.focus();
    return body;
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
      const body = showOverlay(`<button class="upnext resume" data-action="resume" aria-label="이어 보기">
          ${thumb(video.id, String(video.order), `<span class="play" aria-hidden="true">${icon('play', 32)}</span>`, true)}</button>${listButton}`);
      body.querySelector('[data-action="resume"]')?.addEventListener('click', () => {
        hideOverlay();
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
      if (rewatchLeft !== null) {
        rewatchLeft -= delta;
        if (rewatchLeft <= 0) {
          today = recordRewatch(today, video.id);
          rewatchLeft = null;
        }
      }
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
      // The next picture grows near the end, and the episode can become today's last while it plays (counted after
      // 10 s, or the minutes run low).
      const remaining = total > 0 ? total - current : Math.max(0, video.durationSec - current);
      const html = rowHtml(remaining);
      if (html !== row) {
        row = html;
        const focused = (document.activeElement as HTMLElement | null)?.dataset?.go;
        const box = app.querySelector<HTMLElement>('.nrow')!;
        const bar = app.querySelector<HTMLElement>('.big-bar')!;
        box.innerHTML = html;
        bar.innerHTML = bigBarHtml(remaining);
        bindGo(box);
        bindGo(bar);
        if (focused) (main.classList.contains('big') ? bar : box).querySelector<HTMLElement>(`[data-go="${CSS.escape(focused)}"]`)?.focus();
      }
    },
    onEnded() {
      today = recordFinished(today, video.id);
      history = recordHistoryDone(history, today.date, video.id);
      progress = recordPosition(progress, video.id, null);
      save();
      const u = upNext(scope, video, today, limits, 0, rewatchLeft !== null);
      if (u.kind === 'limit') return openToday();
      showOverlay(endChoiceHtml(u));
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
          <button class="overlay-small" data-action="reload" aria-label="다시 시도">${icon('again', 32)}</button>${listButton}`)
          .querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload());
        return;
      }
      const u = upNextAfterError(scope, video, today, limits);
      const skip = o.advance && u.kind === 'next' && canStart(today, limits, u.video.id);
      const way =
        u.kind === 'next' && canStart(today, limits, u.video.id)
          ? `<button class="overlay-small" data-next="${esc(u.video.id)}" aria-label="다음 편">${icon('skip-forward', 32)}</button>`
          : u.kind === 'limit'
            ? upNextCardHtml(u, c)
            : listButton;
      showOverlay(`<div class="overlay-icon" aria-hidden="true">${icon('unplug', 64)}</div>
        <p class="overlay-text" role="status">이 영상은 지금 볼 수 없어요${skip ? '. 곧 다음 편으로 넘어가요' : ''}</p>
        ${skip ? '' : way}`);
      if (skip) skipTimer = window.setTimeout(() => goTo(u.video), SKIP_AFTER_MS);
    },
    onForeignVideo(resumeAt) {
      // P2 + design D8: offer to continue the episode the child was watching.
      const body = showOverlay(`<button class="upnext resume" data-action="resume" aria-label="이어 보기: ${esc(video.displayTitle)}">
          ${thumb(video.id, String(video.order), `<span class="play" aria-hidden="true">${icon('play', 32)}</span>`, true)}</button>${listButton}`);
      body.querySelector('[data-action="resume"]')?.addEventListener('click', () => {
        hideOverlay();
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
        <p class="overlay-text" role="status">영상을 불러오지 못했어요</p>
        <button class="overlay-small" data-action="reload" aria-label="다시 시도">${icon('again', 32)}</button>${listButton}`)
        .querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload());
    });
}
