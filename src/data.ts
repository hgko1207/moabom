// Loads configs and fetched data at build time (bundled by Vite), so opening the app never waits on a
// data request. Nothing here names a specific collection: every collection comes from config files.

import {
  validateCategories,
  validateCollection,
  validateNews,
  validateProfiles,
  type Category,
  type CollectionConfig,
  type CollectionData,
  type NewsItem,
  type Profile,
} from './config.ts';
import { ICON_NAMES } from './icons.ts';
import profilesRaw from '../config/profiles.json';
import categoriesRaw from '../config/categories.json';
import newsRaw from '../config/news.json';

const configFiles = import.meta.glob<unknown>('../config/collections/*.json', { eager: true, import: 'default' });
const dataFiles = import.meta.glob<CollectionData>('../data/collections/*/videos.json', {
  eager: true,
  import: 'default',
});

export interface Collection {
  config: CollectionConfig;
  data: CollectionData;
}

export interface AppData {
  profiles: Profile[];
  collections: Map<string, Collection>;
  /** home-screen rows, in order */
  categories: Category[];
  /** newest first */
  news: NewsItem[];
  /** Problems a parent should fix in config; shown instead of the app. */
  errors: string[];
}

function fileId(path: string): string {
  return path.split('/').pop()!.replace(/\.json$/, '');
}

export function loadAppData(): AppData {
  const errors: string[] = [];
  const data = new Map(Object.entries(dataFiles).map(([path, d]) => [path.split('/').at(-2)!, d]));
  const collections = new Map<string, Collection>();

  const categories = validateCategories(categoriesRaw, ICON_NAMES);
  if (!categories.ok) errors.push(...categories.errors.map((e) => `config/categories.json: ${e}`));
  const categoryIds = new Set(categories.ok ? categories.value.map((c) => c.id) : []);

  for (const [path, raw] of Object.entries(configFiles)) {
    const id = fileId(path);
    const res = validateCollection(raw, id, categoryIds);
    if (!res.ok) {
      errors.push(...res.errors.map((e) => `config/collections/${id}.json: ${e}`));
      continue;
    }
    if (!res.value.enabled) continue;
    const d = data.get(id);
    if (!d) {
      errors.push(`data/collections/${id}/videos.json is missing (run npm run fetch -- --collection ${id})`);
      continue;
    }
    collections.set(id, { config: res.value, data: d });
  }

  const groups = Object.fromEntries([...collections].map(([id, c]) => [id, c.config.groups.map((g) => g.id)]));
  const profiles = validateProfiles(profilesRaw, groups);
  if (!profiles.ok) errors.push(...profiles.errors.map((e) => `config/profiles.json: ${e}`));

  const news = validateNews(newsRaw);
  if (!news.ok) errors.push(...news.errors.map((e) => `config/news.json: ${e}`));

  return {
    profiles: profiles.ok ? profiles.value.profiles : [],
    collections,
    categories: categories.ok ? categories.value : [],
    news: news.ok ? [...news.value].sort((a, b) => b.date.localeCompare(a.date)) : [],
    errors,
  };
}
