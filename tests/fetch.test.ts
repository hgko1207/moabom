import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CollectionConfig, CollectionData } from '../src/config.ts';
import {
  buildDisplayTitle,
  checkSafety,
  collect,
  draftGroups,
  parseRanges,
  selectUploads,
  selectVideos,
} from '../scripts/fetch.ts';
import { ApiError, createClient, parseDuration, type VideoDetails, type YouTubeClient } from '../scripts/youtube.ts';

const config = (over: Partial<CollectionConfig> = {}): CollectionConfig => ({
  id: 'numberblocks',
  displayName: '넘버블럭스',
  enabled: true,
  channels: ['UC_official'],
  coverVideoId: null,
  groupLabel: '단계',
  groups: [{ id: 'lv1', label: '1단계', playlistId: 'PL1' }],
  excludeShorts: false,
  titleExcludePatterns: [],
  titleStripPatterns: ['^넘버블럭스\\s*', '\\s*\\|.*$'],
  ...over,
});

const video = (id: string, over: Partial<VideoDetails> = {}): VideoDetails => ({
  id,
  title: `넘버블럭스 ${id} | 어린이 수학`,
  channelId: 'UC_official',
  durationSec: 300,
  embeddable: true,
  privacyStatus: 'public',
  ...over,
});

function run(cfg: CollectionConfig, details: VideoDetails[], ids = details.map((d) => d.id)) {
  const logs: string[] = [];
  const entries = ids.map((videoId, position) => ({ videoId, position }));
  const kept = selectVideos(cfg, cfg.groups[0]!, entries, new Map(details.map((d) => [d.id, d])), (m) => logs.push(m));
  return { kept, logs };
}

describe('parseDuration', () => {
  it.each([
    ['PT5M12S', 312],
    ['PT1H2M3S', 3723],
    ['PT45S', 45],
    ['P1DT1S', 86401],
    ['P0D', 0],
    ['garbage', 0],
  ])('%s -> %i', (iso, sec) => expect(parseDuration(iso)).toBe(sec));
});

describe('buildDisplayTitle', () => {
  it('strips the collection prefix and the suffix after |', () => {
    expect(buildDisplayTitle('넘버블럭스 셋 | 어린이 수학 만화', ['^넘버블럭스\\s*', '\\s*\\|.*$'])).toBe('셋');
  });

  it.each([
    ['1 일 | 넘버블록스 - 한국 - 공식 채널', '일'],
    ['36. 이제 우린 육에서 십이에요 | 세는 법을 배우다 | 넘버블록스', '이제 우린 육에서 십이에요'],
    ['지구를 떠나는 100가지 방법 | S5 E30 | 세는 법을 배우다 | 넘버블록스', '지구를 떠나는 100가지 방법'],
    ['|어린이를 위한 기본 도형 배우기 🟦  세는 법을 배우다 | 넘버블록스', '어린이를 위한 기본 도형 배우기 🟦  세는 법을 배우다'],
    ['넘버블록 9에 대한 모든 것 #shorts', '넘버블록 9에 대한 모든 것'],
  ])('checked-in numberblocks patterns clean real channel titles: %s', (title, expected) => {
    const nb = JSON.parse(readFileSync('config/collections/numberblocks.json', 'utf8'));
    expect(buildDisplayTitle(title, nb.titleStripPatterns)).toBe(expected);
  });

  it('falls back to the original title when stripping leaves nothing', () => {
    expect(buildDisplayTitle('넘버블럭스', ['^넘버블럭스\\s*'])).toBe('넘버블럭스');
  });
});

describe('selectVideos', () => {
  it('drops non-whitelisted channels with a warning and keeps official videos in playlist order', () => {
    const { kept, logs } = run(config(), [video('a'), video('b', { channelId: 'UC_reupload' }), video('c')]);
    expect(kept.map((v) => [v.id, v.order, v.displayTitle])).toEqual([
      ['a', 1, 'a'],
      ['c', 2, 'c'],
    ]);
    expect(logs).toEqual([expect.stringMatching(/^WARNING .*b: channel UC_reupload is not whitelisted/)]);
  });

  it('drops deleted, private and non-embeddable videos', () => {
    const { kept } = run(
      config(),
      [video('a'), video('p', { privacyStatus: 'private' }), video('e', { embeddable: false })],
      ['a', 'gone', 'p', 'e'],
    );
    expect(kept.map((v) => v.id)).toEqual(['a']);
  });

  it('keeps short episodes when excludeShorts is off (the default)', () => {
    const { kept } = run(config(), [video('short', { durationSec: 120 })]);
    expect(kept).toHaveLength(1);
  });

  it('treats up to 180s as a Short when excludeShorts is on', () => {
    const { kept, logs } = run(config({ excludeShorts: true }), [
      video('s180', { durationSec: 180 }),
      video('s181', { durationSec: 181 }),
    ]);
    expect(kept.map((v) => v.id)).toEqual(['s181']);
    expect(logs[0]).toMatch(/^WARNING .*treated as a Short/);
  });

  it('applies titleExcludePatterns and ignores duplicate playlist entries', () => {
    const { kept } = run(
      config({ titleExcludePatterns: ['모음'] }),
      [video('a'), video('m', { title: '넘버블럭스 1시간 모음' })],
      ['a', 'a', 'm'],
    );
    expect(kept.map((v) => [v.id, v.order])).toEqual([['a', 1]]);
  });
});

const data = (counts: number[]): CollectionData => ({
  collectionId: 'numberblocks',
  fetchedAt: '2026-10-11T00:00:00.000Z',
  groups: counts.map((n, i) => ({
    id: `lv${i + 1}`,
    videos: Array.from({ length: n }, (_, j) => ({
      id: `v${i}-${j}`,
      title: 't',
      displayTitle: 't',
      durationSec: 300,
      channelId: 'UC_official',
      group: `lv${i + 1}`,
      order: j + 1,
    })),
  })),
});

describe('checkSafety', () => {
  it('skips the drop comparison on the first run but still refuses empty groups', () => {
    expect(checkSafety(null, data([10, 3]), false)).toEqual([]);
    expect(checkSafety(null, data([10, 0]), false)).toEqual(['group "lv2" has 0 videos']);
  });

  it('refuses a drop of more than half, allows exactly half', () => {
    expect(checkSafety(data([10]), data([4]), false)).toEqual(['group "lv1" dropped from 10 to 4 videos']);
    expect(checkSafety(data([10]), data([5]), false)).toEqual([]);
  });

  it('allows anything with --force', () => {
    expect(checkSafety(data([10]), data([0]), true)).toEqual([]);
  });
});

describe('collect', () => {
  it('reads a video-ID group in its listed order without touching playlists', async () => {
    let playlistCalls = 0;
    const client: YouTubeClient = {
      searchChannels: async () => [],
      playlistItems: async () => {
        playlistCalls++;
        return [];
      },
      videos: async (ids) => ids.map((id) => video(id)),
    };
    const cfg = config({ groups: [{ id: 'lv1', label: '1단계', videos: ['c', 'a', 'b'] }] });
    const data = await collect(client, cfg, new Date('2026-10-12T00:00:00Z'), () => {});
    expect(playlistCalls).toBe(0);
    expect(data.groups[0]!.videos.map((v) => [v.id, v.order])).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 3],
    ]);
  });

  it('propagates API errors so nothing is written', async () => {
    const client: YouTubeClient = {
      searchChannels: async () => [],
      playlistItems: async () => {
        throw new ApiError('playlistItems', 404, 'playlistNotFound', '');
      },
      videos: async () => [],
    };
    await expect(collect(client, config(), new Date(), () => {})).rejects.toThrow(/playlistNotFound/);
  });
});

describe('selectUploads', () => {
  const uploads = ['n1', 'short', 'n2', 'n3', 'blocked'].map((videoId, position) => ({ videoId, position }));
  const details = new Map(
    [
      video('n1', { durationSec: 3600, title: '모음집 A' }),
      video('short', { durationSec: 60, title: '모음집 S' }),
      video('n2', { durationSec: 1900, title: '노래 모음' }),
      video('n3', { durationSec: 2400, title: '모음집 B' }),
      video('blocked', { durationSec: 3000, title: '모음집 C', embeddable: false }),
    ].map((v) => [v.id, v]),
  );

  it('keeps the newest N uploads inside the duration window, renumbered from 0', () => {
    expect(selectUploads(uploads, details, { minSec: 901, latest: 2 })).toEqual([
      { videoId: 'n1', position: 0 },
      { videoId: 'n2', position: 1 },
    ]);
  });

  it('filters by title pattern and skips non-embeddable videos', () => {
    expect(selectUploads(uploads, details, { minSec: 901, titlePattern: '^모음집' }).map((e) => e.videoId)).toEqual(['n1', 'n3']);
  });
});

describe('collect with an uploads group', () => {
  it('reads the channel uploads once and shares them between groups', async () => {
    let uploadCalls = 0;
    const client: YouTubeClient = {
      searchChannels: async () => [],
      playlistItems: async (id) => {
        if (id === 'UU_official') uploadCalls++;
        return ['a', 'b', 'c'].map((videoId, position) => ({ videoId, position }));
      },
      videos: async (ids) => ids.map((id) => video(id, { durationSec: id === 'a' ? 300 : 2000 })),
    };
    const cfg = config({
      groups: [
        { id: 'long', label: '모음', kind: 'free', uploads: { minSec: 901 } },
        { id: 'short', label: '편', uploads: { maxSec: 900 } },
      ],
    });
    const data = await collect(client, cfg, new Date(), () => {});
    expect(uploadCalls).toBe(1);
    expect(data.groups.map((g) => [g.id, g.videos.map((v) => v.id)])).toEqual([
      ['long', ['b', 'c']],
      ['short', ['a']],
    ]);
  });
});

describe('draftGroups', () => {
  const ep = (id: string, title: string, durationSec = 300) => video(id, { title, durationSec });
  const EPISODE = /^(\d+)[.\s]/u;

  it('groups episodes by number, newest upload wins, duplicates and gaps are reported', () => {
    const uploads = [
      ep('new2', '2 다른 하나 | 넘버블록스'),
      ep('one', '1 일 | 넘버블록스'),
      ep('old2', '2 다른 하나 | 넘버블록스'),
      ep('four', '4. 넷 | 넘버블록스'),
    ];
    const [g] = draftGroups(uploads, [[1, 4]], EPISODE);
    expect(g!.videos).toEqual(['one', 'new2', 'four']);
    expect(g!.missing).toEqual([3]);
    expect(g!.picks[1]!.alternatives).toEqual([{ id: 'old2', title: '2 다른 하나 | 넘버블록스' }]);
    expect([g!.id, g!.label]).toEqual(['lv1', '1단계']);
  });

  it('ignores Shorts, compilations and titles without an episode number', () => {
    const uploads = [ep('short', '1 일 #shorts', 50), ep('comp', '1 일 모음집', 3600), ep('song', '숫자 노래')];
    expect(draftGroups(uploads, [[1, 1]], EPISODE)[0]!.missing).toEqual([1]);
  });

  it('supports a custom pattern such as season episodes', () => {
    const uploads = [ep('s5e1', '차이점 | S5 E01 | 넘버블록스')];
    expect(draftGroups(uploads, [[1, 1]], /S5 E(\d+)/u)[0]!.videos).toEqual(['s5e1']);
  });
});

describe('parseRanges', () => {
  it('parses comma-separated ranges', () => {
    expect(parseRanges('1-15, 16-30')).toEqual([
      [1, 15],
      [16, 30],
    ]);
  });

  it.each(['15-1', 'abc', '1-'])('rejects %s', (bad) => {
    expect(() => parseRanges(bad)).toThrow(/invalid range/);
  });
});

describe('createClient', () => {
  const KEY = 'SECRET-KEY-123';

  it('never puts the API key in error messages', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'API key not valid', errors: [{ reason: 'keyInvalid' }] } }), {
        status: 400,
      })) as typeof fetch;
    const err = await createClient(KEY, fakeFetch).videos(['a']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).reason).toBe('keyInvalid');
    expect(String((err as Error).message)).not.toContain(KEY);
  });

  it('reports network failures as ApiError without the key', async () => {
    const fakeFetch = (async (url: URL) => {
      throw new TypeError(`fetch failed for ${url.origin}`);
    }) as unknown as typeof fetch;
    const err = await createClient(KEY, fakeFetch).playlistItems('PL1').catch((e: unknown) => e);
    expect((err as ApiError).reason).toBe('network');
    expect(String((err as Error).message)).not.toContain(KEY);
  });

  it('follows playlist pages and batches video lookups by 50', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: URL) => {
      const endpoint = url.pathname.split('/').pop()!;
      calls.push(endpoint);
      if (endpoint === 'playlistItems') {
        const page2 = url.searchParams.get('pageToken') === 'next';
        const items = (page2 ? [2, 1] : [0]).map((p) => ({ snippet: { position: p }, contentDetails: { videoId: `v${p}` } }));
        return new Response(JSON.stringify({ items, ...(page2 ? {} : { nextPageToken: 'next' }) }));
      }
      const ids = url.searchParams.get('id')!.split(',');
      return new Response(
        JSON.stringify({
          items: ids.map((id) => ({
            id,
            snippet: { title: id, channelId: 'UC' },
            contentDetails: { duration: 'PT1M' },
            status: { embeddable: true, privacyStatus: 'public' },
          })),
        }),
      );
    }) as unknown as typeof fetch;
    const client = createClient(KEY, fakeFetch);
    expect((await client.playlistItems('PL1')).map((e) => e.videoId)).toEqual(['v0', 'v1', 'v2']);
    const many = Array.from({ length: 120 }, (_, i) => `id${i}`);
    expect(await client.videos(many)).toHaveLength(120);
    expect(calls.filter((c) => c === 'videos')).toHaveLength(3);
  });

  it('requires a key', () => {
    expect(() => createClient('')).toThrow(/YOUTUBE_API_KEY/);
  });
});
