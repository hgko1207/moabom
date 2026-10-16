// localStorage wrapper. Every access is guarded: private browsing, blocked storage or a full quota
// must never break the screen, so failures fall back to an in-memory map for the session.

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CollectionProgress {
  /** videoId -> completion time (ms) */
  watched: Record<string, number>;
  /** videoId -> accumulated played seconds, cleared on completion */
  progress: Record<string, number>;
  /** videoId -> time (ms) the player reported an error on this device */
  failed: Record<string, number>;
  /** videoId -> last playback position (s), so long compilations continue where they stopped */
  position: Record<string, number>;
  last: string | null;
  /** When `last` was last played (ms); picks the home screen's 이어 보기 across collections. */
  lastAt?: number;
}

export interface TodayState {
  date: string;
  started: string[];
  finished: string[];
  playedToday: Record<string, number>;
  seconds: number;
  /** Long videos cut off by the daily limit; they continue tomorrow, not today. */
  stopped: string[];
}

export type LimitMode = 'none' | 'minutes' | 'episodes';

/** Parent settings kept on this device; they override config/profiles.json. */
export interface DeviceSettings {
  limit: { mode: LimitMode; value: number };
  /** Collections a parent turned off on this device. New collections are shown until turned off. */
  hidden?: string[];
  /** Collection order chosen by a parent; collections not listed follow in config order. */
  order?: string[];
  /** The home screen's 이어 보기 card; missing means on. */
  homeContinue?: boolean;
  /** Home screen title; empty or missing means the profile name from config. */
  title?: string;
}

export interface DeviceToday {
  date: string;
  profileId: string;
}

const PREFIX = 'moabom:v1:';

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

/** The browser's localStorage when usable, otherwise a per-session in-memory store. */
export function browserKV(): KV {
  try {
    const ls = globalThis.localStorage;
    const probe = `${PREFIX}probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryKV();
  }
}

export function createStore(kv: KV) {
  const fallback = memoryKV();

  function read<T>(key: string): T | null {
    let raw: string | null = null;
    try {
      raw = kv.getItem(PREFIX + key);
    } catch {
      // storage unavailable; the session fallback below still holds this session's writes
    }
    raw ??= fallback.getItem(PREFIX + key);
    try {
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  function write(key: string, value: unknown): void {
    const raw = JSON.stringify(value);
    try {
      kv.setItem(PREFIX + key, raw);
    } catch {
      fallback.setItem(PREFIX + key, raw);
    }
  }

  return {
    progress(profileId: string, collectionId: string): CollectionProgress {
      const p = read<Partial<CollectionProgress>>(`${profileId}:${collectionId}`);
      return {
        watched: p?.watched ?? {},
        progress: p?.progress ?? {},
        failed: p?.failed ?? {},
        position: p?.position ?? {},
        last: p?.last ?? null,
        ...(p?.lastAt ? { lastAt: p.lastAt } : {}),
      };
    },
    saveProgress(profileId: string, collectionId: string, value: CollectionProgress): void {
      write(`${profileId}:${collectionId}`, value);
    },
    /** Today's counters; a stored state from another day reads as a fresh day. */
    today(profileId: string, date: string): TodayState {
      const t = read<Partial<TodayState>>(`${profileId}:today`);
      if (t?.date === date) {
        return {
          date,
          started: t.started ?? [],
          finished: t.finished ?? [],
          playedToday: t.playedToday ?? {},
          seconds: t.seconds ?? 0,
          stopped: t.stopped ?? [],
        };
      }
      return { date, started: [], finished: [], playedToday: {}, seconds: 0, stopped: [] };
    },
    saveToday(profileId: string, value: TodayState): void {
      write(`${profileId}:today`, value);
    },
    deviceToday(): DeviceToday | null {
      return read<DeviceToday>('device:today');
    },
    saveDeviceToday(value: DeviceToday): void {
      write('device:today', value);
    },
    /** null until a parent saves settings on this device. */
    settings(): DeviceSettings | null {
      return read<DeviceSettings>('device:settings');
    },
    saveSettings(value: DeviceSettings): void {
      write('device:settings', value);
    },
    pinned(): string | null {
      return read<string>('device:pinned');
    },
    savePinned(profileId: string): void {
      write('device:pinned', profileId);
    },
    installHintDismissed(): boolean {
      return read<boolean>('device:installHint') === false;
    },
    dismissInstallHint(): void {
      write('device:installHint', false);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
