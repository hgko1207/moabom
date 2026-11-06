// Downloads a Fluent Emoji Flat picture (Microsoft, MIT) into public/tabicons for a collection group's `icon`.
// Browse names at https://icon-sets.iconify.design/fluent-emoji-flat/

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT_DIR = join(import.meta.dirname, '..', 'public', 'tabicons');

async function main(): Promise<void> {
  const names = process.argv.slice(2);
  if (names.length === 0) throw new Error('usage: npm run tab-icon -- <name> [<name> ...]');
  for (const name of names) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`"${name}" is not an icon name`);
    const res = await fetch(`https://api.iconify.design/fluent-emoji-flat/${name}.svg`);
    const svg = await res.text();
    if (!res.ok || !svg.startsWith('<svg')) throw new Error(`no icon named "${name}" in fluent-emoji-flat`);
    await writeFile(join(OUT_DIR, `${name}.svg`), svg, 'utf8');
    console.log(`public/tabicons/${name}.svg`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1; // process.exit() right after fetch aborts on Windows
});
