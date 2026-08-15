/**
 * Forest Camp — a sunlit clearing: camp, archery range, rock outcrop and a bridge.
 * Kenney Mini Forest kit, CC0.   node scripts/worlds/forest.mjs <kits-dir> [out.glb]
 *
 * Mini-forest pieces are ~1 unit across, so the whole world is scaled ×5 to put a
 * tree at ~8-11 m. Everything sits on flat ground: no wall alignment to worry about.
 */
import { World, cli } from './lib.mjs';

const { kitsDir, out } = cli('public/assets/samples/forest/ForestCamp.glb');
const w = new World(kitsDir, { f: 'mini-forest' }, { scale: 5, name: 'ForestCamp' });

const GRASS = '#6fae54';
const CLEARING = '#8cc768';
const STREAM = '#4d90b8';

w.slab('ground', -14, -14, 14, 14, GRASS, -0.02);
w.slab('clearing', -5, -5, 5, 5, CLEARING, -0.01);
w.slab('stream', -14, 7.4, 14, 9.2, STREAM, -0.005);

// --- The camp, at the middle of the clearing ---------------------------------
await w.place('f', 'tent', -2.4, -2.2, { rot: 25, label: 'blue-tent' });            // 1 the tent
await w.place('f', 'patch-dirt', 0, 0, { s: 2.4, label: 'campfire-patch' });        // 2 the fire pit
await w.place('f', 'stones', 0, 0, { label: 'fire-stones' });
await w.place('f', 'flag', 2.6, -2.6, { label: 'flag' });                           // 3 the flag
await w.place('f', 'character-archer', 1.6, 1.4, { rot: 200, label: 'archer' });    // 4 the archer
await w.place('f', 'weapon-bow', 2.2, 1.9, { rot: 200 });

// --- Archery range, east ------------------------------------------------------
await w.place('f', 'target', 7.5, -0.6, { rot: 270, label: 'target-a' });           // 5 the targets
await w.place('f', 'target', 7.5, 1.4, { rot: 270, label: 'target-b' });
await w.place('f', 'weapon-arrow', 5.6, 0.4, { rot: 270 });
for (const z of [-1.6, -0.6, 0.4, 1.4, 2.4]) await w.place('f', 'fence', 4.4, z, { rot: 90 });

// --- Rock outcrop with a lookout platform, west --------------------------------
await w.place('f', 'rocks-high', -8, 1, { label: 'outcrop' });                      // 6 the outcrop
await w.place('f', 'rocks-low', -7, 2.6, {});
await w.place('f', 'rocks-ramp', -6.4, 0.2, { rot: 90 });
await w.place('f', 'ladder', -8, 2.1, { y: 1, label: 'ladder' });                   // 7 the ladder
await w.place('f', 'platform', -8, 1, { y: 1.5, label: 'lookout' });                // 8 the lookout
await w.place('f', 'building-platform', -8, 1, { y: 2, s: 0.9 });
await w.place('f', 'building-structure', -8, 1, { y: 2.5, s: 0.8 });
await w.place('f', 'building-roof', -8, 1, { y: 3.5, s: 0.9, label: 'hut-roof' });  // 9 the hut

// --- The bridge over the stream, north -----------------------------------------
await w.place('f', 'bridge', 0, 8.3, { rot: 90, s: 2.2, label: 'bridge' });         // 10 the bridge
await w.place('f', 'patch-dirt', 0, 6.4, { s: 1.6 });
await w.place('f', 'patch-dirt', 0, 10.2, { s: 1.6 });
await w.place('f', 'stones', -3.4, 8.3, { s: 1.2 });

// --- Trees: a ring around the clearing, denser at the edges ---------------------
const TREES = [
  [-4, -6.5], [-1, -8], [3, -7], [6, -5.5], [8.5, -3], [10, 2], [8.5, 5],
  [4.5, 6.2], [-4.5, 5.8], [-8, 5.5], [-10.5, 2.5], [-10, -3], [-6.5, -4.5],
  [-12, 9.5], [-6, 11], [1.5, 11.5], [7, 10.5], [11.5, 8],
];
// (a plain loop, not forEach(async …): every place() must finish before write())
for (const [i, [x, z]] of TREES.entries()) await w.place('f', i % 3 === 0 ? 'tree-high' : 'tree', x, z, { rot: (i * 47) % 360 });
for (const [x, z] of TREES) await w.place('f', 'patch-grass', x, z, { s: 1.2, y: -0.01 });
for (const [x, z] of [[-3, 3.5], [3.4, 3.8], [-2, -4.4], [5.5, 2.2], [-5.5, -1.5]]) await w.place('f', 'plant', x, z, {});
for (const [x, z] of [[6.6, 6.8], [-6.6, 3.2], [2.2, -5.4]]) await w.place('f', 'rocks-low', x, z, { s: 0.8 });

await w.write(out);
