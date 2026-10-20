import { defineConfig, type Plugin } from 'vitest/config';

/**
 * The app bundles every collection's videos.json so it never waits on a data request (SPEC: no loading state).
 * Each video also carries the raw YouTube title and channel id for the fetch script and for review; the app
 * reads neither, so the bundle drops them. A new collection then costs about half the bytes.
 */
const APP_VIDEO_FIELDS = ['id', 'displayTitle', 'durationSec', 'group', 'order'] as const;

function slimVideoData(): Plugin {
  return {
    name: 'moabom:slim-video-data',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]data[\\/]collections[\\/][^\\/]+[\\/]videos\.json$/.test(id)) return null;
      const data = JSON.parse(code) as { groups: { videos: Record<string, unknown>[] }[] };
      for (const g of data.groups) g.videos = g.videos.map((v) => Object.fromEntries(APP_VIDEO_FIELDS.map((k) => [k, v[k]])));
      return { code: JSON.stringify(data), map: null };
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [slimVideoData()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
