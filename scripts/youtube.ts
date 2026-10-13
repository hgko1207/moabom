// Minimal YouTube Data API v3 client for the build-time scripts.
// The API key is only ever placed in the request URL; error messages never include the URL.

const API = 'https://www.googleapis.com/youtube/v3';
const BATCH = 50;

export class ApiError extends Error {
  status: number;
  reason: string;
  constructor(endpoint: string, status: number, reason: string, detail: string) {
    super(`YouTube API ${endpoint} failed: ${status} ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
  }
}

export interface ChannelCandidate {
  id: string;
  title: string;
  customUrl: string | null;
  description: string;
  subscriberCount: number | null;
  videoCount: number | null;
}

export interface PlaylistEntry {
  videoId: string;
  /** 0-based position in the playlist. */
  position: number;
}

export interface VideoDetails {
  id: string;
  title: string;
  channelId: string;
  durationSec: number;
  embeddable: boolean;
  privacyStatus: string;
}

export interface PlaylistSummary {
  id: string;
  title: string;
  itemCount: number;
}

export interface YouTubeClient {
  searchChannels(query: string): Promise<ChannelCandidate[]>;
  /** Public playlists a channel made (its own season/episode/compilation lists). */
  channelPlaylists(channelId: string): Promise<PlaylistSummary[]>;
  playlistItems(playlistId: string): Promise<PlaylistEntry[]>;
  videos(ids: string[]): Promise<VideoDetails[]>;
}

type Json = Record<string, any>;

/** ISO 8601 duration (PT1H2M3S, P1DT2H) to seconds. Unparseable input returns 0. */
export function parseDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

export function createClient(apiKey: string, fetchImpl: typeof fetch = fetch): YouTubeClient {
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is not set. Copy .env.example to .env and add your key.');

  async function get(endpoint: string, params: Record<string, string>): Promise<Json> {
    const url = new URL(`${API}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('key', apiKey);
    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch (e) {
      throw new ApiError(endpoint, 0, 'network', e instanceof Error ? e.message : String(e));
    }
    const body = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const err = body.error ?? {};
      const reason = err.errors?.[0]?.reason ?? err.status ?? 'unknown';
      throw new ApiError(endpoint, res.status, String(reason), String(err.message ?? ''));
    }
    return body;
  }

  return {
    async searchChannels(query) {
      const search = await get('search', {
        part: 'snippet',
        type: 'channel',
        q: query,
        maxResults: '10',
        regionCode: 'KR',
        relevanceLanguage: 'ko',
      });
      const ids: string[] = (search.items ?? []).map((i: Json) => i.snippet?.channelId ?? i.id?.channelId).filter(Boolean);
      if (ids.length === 0) return [];
      const channels = await get('channels', { part: 'snippet,statistics', id: ids.join(','), maxResults: '50' });
      const byId = new Map<string, Json>((channels.items ?? []).map((c: Json) => [c.id, c]));
      return ids.flatMap((id) => {
        const c = byId.get(id);
        if (!c) return [];
        const stats = c.statistics ?? {};
        return [
          {
            id,
            title: String(c.snippet?.title ?? ''),
            customUrl: c.snippet?.customUrl ?? null,
            description: String(c.snippet?.description ?? ''),
            subscriberCount: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? NaN) || null,
            videoCount: Number(stats.videoCount ?? NaN) || null,
          },
        ];
      });
    },

    async channelPlaylists(channelId) {
      const out: PlaylistSummary[] = [];
      let pageToken = '';
      do {
        const page = await get('playlists', {
          part: 'snippet,contentDetails',
          channelId,
          maxResults: String(BATCH),
          ...(pageToken ? { pageToken } : {}),
        });
        for (const p of page.items ?? []) {
          out.push({ id: String(p.id), title: String(p.snippet?.title ?? ''), itemCount: Number(p.contentDetails?.itemCount ?? 0) });
        }
        pageToken = page.nextPageToken ?? '';
      } while (pageToken);
      return out;
    },

    async playlistItems(playlistId) {
      const out: PlaylistEntry[] = [];
      let pageToken = '';
      do {
        const page = await get('playlistItems', {
          part: 'snippet,contentDetails',
          playlistId,
          maxResults: String(BATCH),
          ...(pageToken ? { pageToken } : {}),
        });
        for (const item of page.items ?? []) {
          const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
          if (videoId) out.push({ videoId, position: Number(item.snippet?.position ?? out.length) });
        }
        pageToken = page.nextPageToken ?? '';
      } while (pageToken);
      return out.sort((a, b) => a.position - b.position);
    },

    async videos(ids) {
      const out: VideoDetails[] = [];
      for (let i = 0; i < ids.length; i += BATCH) {
        const page = await get('videos', {
          part: 'snippet,contentDetails,status',
          id: ids.slice(i, i + BATCH).join(','),
          maxResults: String(BATCH),
        });
        for (const v of page.items ?? []) {
          out.push({
            id: v.id,
            title: String(v.snippet?.title ?? ''),
            channelId: String(v.snippet?.channelId ?? ''),
            durationSec: parseDuration(String(v.contentDetails?.duration ?? '')),
            embeddable: v.status?.embeddable === true,
            privacyStatus: String(v.status?.privacyStatus ?? 'unknown'),
          });
        }
      }
      return out;
    },
  };
}
