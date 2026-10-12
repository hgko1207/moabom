// Thin wrapper over the YouTube IFrame Player API (SPEC §8 P1, P2, P4).
// Polls once a second: real playing time feeds the daily limit and progress, and the playing video ID is
// compared with the one the app loaded so a related-video click inside the iframe is caught.

interface YTPlayer {
  loadVideoById(args: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoUrl(): string;
  getVideoData?(): { video_id?: string };
  destroy(): void;
}

interface YTNamespace {
  Player: new (el: HTMLElement, options: Record<string, unknown>) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const ENDED = 0;
const PLAYING = 1;

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  apiPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('iframe_api failed to load'));
    };
    document.head.append(s);
  });
  return apiPromise;
}

export interface PlayerEvents {
  /** Called about once a second while playing; `delta` is real elapsed playing time in seconds. */
  onPlaying(delta: number, current: number, duration: number): void;
  onEnded(): void;
  onError(code: number): void;
  /** A different video started inside the iframe; `resumeAt` is the last position of the app's video. */
  onForeignVideo(resumeAt: number): void;
  /** Neither getVideoUrl nor getVideoData reports an ID on this device, so P2 cannot work. */
  onDetectionUnavailable(): void;
}

export interface PlayerHandle {
  load(videoId: string, startSeconds?: number): void;
  stop(): void;
  destroy(): void;
}

function playingId(p: YTPlayer): string | null {
  try {
    const v = new URL(p.getVideoUrl()).searchParams.get('v');
    if (v) return v;
  } catch {
    // getVideoUrl may be empty while loading
  }
  try {
    return p.getVideoData?.()?.video_id || null;
  } catch {
    return null;
  }
}

export async function createPlayer(
  el: HTMLElement,
  videoId: string,
  events: PlayerEvents,
  startSeconds = 0,
): Promise<PlayerHandle> {
  const YT = await loadApi();
  let expected = videoId;
  /** Comparison starts only after the app's own video is confirmed playing (avoids flagging our own loads). */
  let armed = false;
  let lastGood = startSeconds;
  let lastTick = 0;
  let detectionChecked = false;
  let destroyed = false;

  const player: YTPlayer = await new Promise((resolve) => {
    // Default youtube.com host (not youtube-nocookie.com): the signed-in YouTube Premium session in Chrome is
    // only recognised with YouTube cookies, so the family's Premium account plays without ads (2026-10-12).
    const p = new YT.Player(el, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { rel: 0, playsinline: 1, fs: 0, iv_load_policy: 3, autoplay: 1, start: startSeconds, origin: location.origin },
      events: {
        onReady: () => resolve(p),
        onStateChange: (e: { data: number }) => {
          if (destroyed) return;
          if (e.data === PLAYING) {
            lastTick = performance.now();
            if (playingId(p) === expected) armed = true;
          }
          if (e.data === ENDED && armed && playingId(p) === expected) events.onEnded();
        },
        onError: (e: { data: number }) => {
          if (!destroyed) events.onError(e.data);
        },
      },
    });
  });

  const timer = window.setInterval(() => {
    if (destroyed) return;
    let state: number;
    try {
      state = player.getPlayerState();
    } catch {
      return;
    }
    const id = playingId(player);

    if (state === PLAYING && !detectionChecked) {
      detectionChecked = true;
      if (id === null) {
        console.warn('moabom: cannot read the playing video ID; foreign-video detection is off on this device');
        events.onDetectionUnavailable();
      }
    }

    if (armed && id !== null && id !== expected) {
      armed = false;
      player.stopVideo();
      events.onForeignVideo(lastGood);
      return;
    }

    if (state !== PLAYING || id !== expected) return;
    armed = true;
    const now = performance.now();
    const delta = Math.min(2, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    lastGood = player.getCurrentTime();
    events.onPlaying(delta, lastGood, player.getDuration());
  }, 1000);

  return {
    load(id, startSeconds = 0) {
      expected = id;
      armed = false;
      lastGood = startSeconds;
      player.loadVideoById({ videoId: id, startSeconds });
    },
    stop() {
      player.stopVideo();
    },
    destroy() {
      destroyed = true;
      window.clearInterval(timer);
      try {
        player.destroy();
      } catch {
        // already gone
      }
    },
  };
}
