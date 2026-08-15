/**
 * Bake one or all sample worlds:   npm run world -- <kits-dir> [street|cave|forest|dungeon|all]
 * <kits-dir> holds the unzipped Kenney kits (folder names as on kenney.nl):
 *   city-kit-suburban city-kit-roads city-kit-commercial modular-cave-kit mini-forest modular-dungeon-kit
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const [kitsDir, which = 'all'] = process.argv.slice(2);
if (!kitsDir) { console.error('usage: npm run world -- <kits-dir> [street|cave|forest|dungeon|all]'); process.exit(1); }
const names = which === 'all' ? ['street', 'cave', 'forest', 'dungeon'] : [which];
for (const n of names) {
  const r = spawnSync(process.execPath, [resolve(here, `${n}.mjs`), kitsDir], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
