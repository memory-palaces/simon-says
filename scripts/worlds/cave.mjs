/**
 * Plato's Cave — a chain of cavern chambers, from the prisoners' cell past the fire
 * hall out to daylight. Kenney Modular Cave Kit + Mini Forest (for the outside), CC0.
 *   node scripts/worlds/cave.mjs <kits-dir> [out.glb]
 *
 * The cave kit is already in metres on a 4 m grid. A `corridor` tile at rot 0 runs
 * EAST-WEST (its walls sit on the north/south edges), so north-south runs need
 * rot 90. Rooms are 12 (small) / 20 (large) across and open on all four sides.
 * Walls are ~4.4 m; there is no roof — the app's dark background does that.
 */
import { World, cli } from './lib.mjs';

const { kitsDir, out } = cli('public/assets/samples/cave/PlatosCave.glb');
const w = new World(kitsDir, { cave: 'modular-cave-kit', forest: 'mini-forest' }, { scale: 1, name: 'PlatosCave' });

const ROCK = '#5a3f39';
const DIRT = '#b9743f';
const GRASS = '#7fbf5a';

// Bedrock under everything so nothing looks out onto the void.
w.slab('bedrock', -60, -60, 60, 60, ROCK, -0.05);

// --- Fire Hall: the big central chamber (openings N/S/E/W at the side centres) ---
await w.place('cave', 'room-large', 0, 0, { label: 'fire-hall' });
await w.place('cave', 'template-detail', 0, 0, { label: 'fire-pit', s: 1.6 });        // 3 the fire
await w.place('cave', 'ladder', 8.4, -8.4, { rot: 45, label: 'ladder' });

// --- North: the Prisoners' Cell behind bars -----------------------------------------
await w.place('cave', 'corridor', 0, -12, { rot: 90 });
await w.place('cave', 'gate-metal-bars', 0, -14.6, { label: 'prison-bars' });        // 2 the bars
await w.place('cave', 'corridor', 0, -16, { rot: 90 });
await w.place('cave', 'room-small', 0, -24, { label: 'prisoners-cell' });               // 1 the cell (start)
await w.place('cave', 'template-wall-detail-a', 0, -29.5, { label: 'shadow-wall' });   // the wall the shadows fall on

// --- East: the Shadow Gallery, a long wide room ---------------------------------------
await w.place('cave', 'corridor', 12, 0);
await w.place('cave', 'corridor', 16, 0);
await w.place('cave', 'room-wide', 28, 0, { label: 'shadow-gallery' });               // 4
await w.place('cave', 'stairs', 34, 2, { rot: 270, label: 'gallery-stairs' });          // 5 stairs up a ledge

// --- West: the Echo Chamber (a dead end with a puddle) -------------------------------
await w.place('cave', 'corridor', -12, 0);
await w.place('cave', 'corridor', -16, 0);
await w.place('cave', 'room-small', -24, 0, { label: 'echo-chamber' });               // 6
w.slab('puddle', -27, -3, -21, 3, '#3a6a8a', 0.03);                                     // 7 the pool
await w.place('cave', 'ladder', -29.3, 0, { rot: 90, label: 'echo-ladder' });

// --- South: the way out — corridor, rock gate, daylight ---------------------------------
await w.place('cave', 'corridor', 0, 12, { rot: 90 });
await w.place('cave', 'corridor', 0, 16, { rot: 90 });
await w.place('cave', 'corridor', 0, 20, { rot: 90 });
await w.place('cave', 'corridor', 0, 24, { rot: 90, label: 'cave-mouth' });           // 8 the passage's last tile
await w.place('cave', 'gate-rock', 0, 25.9, { label: 'rock-gate' });                  // 9 the exit arch
// Outside: sun-lit grass, a tree, rocks and a tent — the world of forms.
w.slab('daylight-grass', -30, 26.5, 30, 60, GRASS, -0.02);
w.slab('dirt-path', -2, 26.5, 2, 42, DIRT, -0.01);
const F = 4.5; // mini-forest pieces are tiny; scale them up
await w.place('forest', 'tree-high', -8, 36, { s: F, label: 'sun-tree' });           // 10 the tree
await w.place('forest', 'tree', 9, 34, { s: F });
await w.place('forest', 'tree', -14, 46, { s: F * 1.1 });
await w.place('forest', 'tree-high', 15, 45, { s: F });
await w.place('forest', 'rocks-low', 7, 41, { s: F });
await w.place('forest', 'tent', -6, 46, { s: F, rot: 30, label: 'tent' });            // 11 the tent
await w.place('forest', 'target', 4, 50, { s: F, rot: 180, label: 'target' });        // 12 the target
await w.place('forest', 'flag', 0, 44, { s: F });
await w.place('forest', 'patch-grass', -6, 46, { s: F * 1.5, y: -0.05 });

await w.write(out);
