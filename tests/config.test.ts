import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  accentProblems,
  contrastRatio,
  validateCategories,
  validateCollection,
  validateNews,
  validateProfiles,
} from '../src/config.ts';
import { ICON_NAMES } from '../src/icons.ts';

const collection = () => ({
  id: 'numberblocks',
  displayName: '넘버블럭스',
  category: 'numbers-letters',
  enabled: true,
  channels: ['UC_official'],
  coverVideoId: null,
  groupLabel: '단계',
  groups: [
    { id: 'lv1', label: '1단계', playlistId: 'PL1' },
    { id: 'lv2', label: '2단계', playlistId: 'PL2' },
  ],
  excludeShorts: false,
  titleExcludePatterns: [],
  titleStripPatterns: ['^넘버블럭스\\s*'],
});

const profiles = () => ({
  profiles: [
    { id: 'p1', name: '첫째', color: '#4C8BF5', collections: ['numberblocks'], dailyEpisodes: 3, dailyMinutes: null },
    {
      id: 'p2',
      name: '둘째',
      color: '#2E9E6B',
      collections: ['numberblocks'],
      startGroup: { numberblocks: 'lv1' },
      dailyEpisodes: 2,
      dailyMinutes: null,
    },
  ],
});

const groups = { numberblocks: ['lv1', 'lv2'] };

function errorsOf(res: { ok: boolean; errors?: string[] }): string[] {
  return res.ok ? [] : (res.errors ?? []);
}

describe('validateCollection', () => {
  it('accepts a complete config', () => {
    expect(validateCollection(collection(), 'numberblocks').ok).toBe(true);
  });

  it('refuses fetch without a confirmed official channel', () => {
    const c = { ...collection(), channels: [] };
    expect(errorsOf(validateCollection(c))).toEqual([expect.stringContaining('channels must list')]);
  });

  it('reports every problem at once', () => {
    const c = {
      ...collection(),
      id: 'NumberBlocks',
      groups: [
        { id: 'lv1', label: '1단계', playlistId: '' },
        { id: 'lv1', label: '', playlistId: 'PL2' },
      ],
      titleStripPatterns: ['('],
    };
    const errors = errorsOf(validateCollection(c));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('id must match'),
        expect.stringContaining('groups[0].playlistId'),
        expect.stringContaining('groups[1].id "lv1" is duplicated'),
        expect.stringContaining('groups[1].label'),
        expect.stringContaining('invalid regular expression'),
      ]),
    );
  });

  it('accepts a group defined by video IDs (made-for-kids videos cannot be saved to playlists)', () => {
    const c = { ...collection(), groups: [{ id: 'lv1', label: '1단계', videos: ['a', 'b'] }] };
    expect(validateCollection(c).ok).toBe(true);
  });

  it('requires exactly one group source', () => {
    const c = {
      ...collection(),
      groups: [
        { id: 'lv1', label: '1단계', playlistId: 'PL1', videos: ['a'] },
        { id: 'lv2', label: '2단계' },
        { id: 'lv3', label: '3단계', videos: [] },
      ],
    };
    expect(errorsOf(validateCollection(c))).toEqual([
      'groups[0] needs exactly one of playlistId, videos or uploads',
      'groups[1] needs exactly one of playlistId, videos or uploads',
      'groups[2].videos must be a non-empty array of video IDs',
    ]);
  });

  it('accepts an uploads rule group and a free kind', () => {
    const c = {
      ...collection(),
      groups: [{ id: 'mix', label: '모음집', kind: 'free', uploads: { minSec: 901, latest: 30, titlePattern: '모음' } }],
    };
    expect(validateCollection(c).ok).toBe(true);
  });

  it('rejects a bad kind and bad uploads values', () => {
    const c = {
      ...collection(),
      groups: [{ id: 'mix', label: '모음집', kind: 'bonus', uploads: { minSec: -1, latest: 1.5, titlePattern: '(' } }],
    };
    expect(errorsOf(validateCollection(c))).toEqual([
      'groups[0].kind must be "series" or "free"',
      'groups[0].uploads.minSec must be a positive integer',
      'groups[0].uploads.latest must be a positive integer',
      'groups[0].uploads.titlePattern has an invalid regular expression: (',
    ]);
  });

  it('catches a file name that does not match the id', () => {
    expect(errorsOf(validateCollection(collection(), 'pokemon'))).toEqual([expect.stringContaining('file name')]);
  });
});

describe('validateProfiles', () => {
  it('accepts valid profiles', () => {
    expect(validateProfiles(profiles(), groups).ok).toBe(true);
  });

  it('treats both limits null as unlimited (valid)', () => {
    const p = profiles();
    p.profiles[0] = { ...p.profiles[0]!, dailyEpisodes: null as unknown as number };
    expect(validateProfiles(p, groups).ok).toBe(true);
  });

  it('rejects prereq because it is a v1.1 feature', () => {
    expect(errorsOf(validateProfiles({ ...profiles(), prereq: [] }, groups))).toEqual([
      expect.stringContaining('v1.1'),
    ]);
  });

  it('rejects unknown collections, unknown start groups, bad colors and negative limits', () => {
    const p = profiles();
    p.profiles[0] = { ...p.profiles[0]!, collections: ['pokemon'], color: 'blue', dailyEpisodes: -1 };
    p.profiles[1] = { ...p.profiles[1]!, startGroup: { numberblocks: 'lv9' } };
    expect(errorsOf(validateProfiles(p, groups))).toEqual([
      expect.stringContaining('color'),
      expect.stringContaining('dailyEpisodes'),
      expect.stringContaining('unknown collection "pokemon"'),
      expect.stringContaining('unknown group "lv9"'),
    ]);
  });

  it('keeps every checked-in config valid (collections, profiles, categories, news)', () => {
    const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
    const categories = validateCategories(read('config/categories.json'), ICON_NAMES);
    expect(errorsOf(categories)).toEqual([]);
    const categoryIds = new Set(categories.ok ? categories.value.map((c) => c.id) : []);
    const groups: Record<string, string[]> = {};
    for (const file of readdirSync('config/collections').filter((f) => f.endsWith('.json'))) {
      const c = read(`config/collections/${file}`);
      expect(errorsOf(validateCollection(c, file.replace(/\.json$/, ''), categoryIds))).toEqual([]);
      groups[c.id] = c.groups.map((g: { id: string }) => g.id);
    }
    expect(errorsOf(validateProfiles(read('config/profiles.json'), groups))).toEqual([]);
    expect(errorsOf(validateNews(read('config/news.json')))).toEqual([]);
  });
});

describe('collection category', () => {
  it('is required and must name a category from categories.json', () => {
    const { category: _, ...noCategory } = collection();
    expect(errorsOf(validateCollection(noCategory))).toEqual([expect.stringContaining('category is required')]);
    expect(errorsOf(validateCollection({ ...collection(), category: 'cartoons' }, undefined, new Set(['stories'])))).toEqual([
      expect.stringContaining('category "cartoons" is not in config/categories.json'),
    ]);
  });
});

describe('validateCategories', () => {
  const ok = { id: 'stories', label: '이야기', icon: 'book-open', color: '#C2410C' };

  it('accepts icons from src/icons.ts and dark enough colours', () => {
    expect(validateCategories({ categories: [ok] }, ICON_NAMES)).toEqual({ ok: true, value: [ok] });
  });

  it('reports unknown icons, bad colours, light colours and duplicate ids together', () => {
    const res = validateCategories(
      {
        categories: [
          ok,
          { ...ok, icon: 'rocket' },
          { ...ok, id: 'a', color: 'orange' },
          { ...ok, id: 'b', color: '#FFD966' },
        ],
      },
      ICON_NAMES,
    );
    expect(errorsOf(res)).toEqual([
      expect.stringContaining('categories[1].id "stories" is duplicated'),
      expect.stringContaining('categories[1].icon must be one of src/icons.ts'),
      expect.stringContaining('categories[2].color must be #RRGGBB'),
      expect.stringContaining('categories[3].color #FFD966 is too light'),
    ]);
  });

  it('rejects an empty list', () => {
    expect(errorsOf(validateCategories({ categories: [] }, ICON_NAMES))).toHaveLength(1);
  });

  it('measures contrast like WCAG', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
  });
});

describe('accent colours (P2-6)', () => {
  it('accepts mid-tone colours readable as borders and under --ink text', () => {
    expect(accentProblems('#4C8BF5')).toEqual([]);
    expect(accentProblems('#2E9E6B')).toEqual([]);
  });

  it('rejects colours too light for borders or too dark for --ink text', () => {
    expect(accentProblems('#F59F00')).toEqual([expect.stringContaining('too light')]);
    expect(accentProblems('#7048E8')).toEqual([expect.stringContaining('too dark')]);
  });

  it('checks a collection colour and a profile colour', () => {
    expect(errorsOf(validateCollection({ ...collection(), color: '#F59F00' }))).toEqual([expect.stringContaining('color #F59F00 is too light')]);
    expect(errorsOf(validateCollection({ ...collection(), color: 'blue' }))).toEqual(['color must be #RRGGBB']);
    expect(validateCollection({ ...collection(), color: '#2E9E6B' }).ok).toBe(true);
    const p = profiles();
    p.profiles[0] = { ...p.profiles[0]!, color: '#7048E8' };
    expect(errorsOf(validateProfiles(p, { numberblocks: ['lv1', 'lv2'] }))).toEqual([expect.stringContaining('profiles[0].color #7048E8 is too dark')]);
  });
});

describe('validateNews', () => {
  const item = { id: 'launch', date: '2026-10-19', title: '시작', body: '모아봄을 시작했어요' };

  it('accepts an empty list', () => {
    expect(validateNews({ items: [] })).toEqual({ ok: true, value: [] });
  });

  it('needs a unique id, a date, a title and a body', () => {
    expect(errorsOf(validateNews({ items: [item, { ...item, date: '10/19', title: '', body: undefined }] }))).toEqual([
      expect.stringContaining('items[1].id "launch" is duplicated'),
      expect.stringContaining('items[1].date must be YYYY-MM-DD'),
      expect.stringContaining('items[1].title is required'),
      expect.stringContaining('items[1].body is required'),
    ]);
  });
});
