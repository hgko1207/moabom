import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateCollection, validateProfiles } from '../src/config.ts';

const collection = () => ({
  id: 'numberblocks',
  displayName: '넘버블럭스',
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
      color: '#F5A04C',
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
      'groups[0] needs exactly one of playlistId or videos',
      'groups[1] needs exactly one of playlistId or videos',
      'groups[2].videos must be a non-empty array of video IDs',
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

  it('keeps the checked-in profiles.json valid against the checked-in collections', () => {
    const repoProfiles = JSON.parse(readFileSync('config/profiles.json', 'utf8'));
    const nb = JSON.parse(readFileSync('config/collections/numberblocks.json', 'utf8'));
    const res = validateProfiles(repoProfiles, { [nb.id]: nb.groups.map((g: { id: string }) => g.id) });
    expect(errorsOf(res)).toEqual([]);
  });
});
