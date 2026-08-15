/**
 * The Dungeon — a keep's undercroft: entrance hall, barred cell, treasury, a long
 * gallery and a stair down. Kenney Modular Dungeon Kit, CC0.
 *   node scripts/worlds/dungeon.mjs <kits-dir> [out.glb]
 *
 * Same 4 m grid and conventions as the cave kit: a `corridor` tile at rot 0 runs
 * EAST-WEST, so north-south runs need rot 90. Rooms open on all four sides.
 */
import { World, cli } from './lib.mjs';

const { kitsDir, out } = cli('public/assets/samples/dungeon/Dungeon.glb');
const w = new World(kitsDir, { d: 'modular-dungeon-kit' }, { scale: 1, name: 'Dungeon' });

w.slab('bedrock', -50, -50, 50, 50, '#2e2a33', -0.05);

// --- Entrance hall (south), where you arrive ----------------------------------
await w.place('d', 'room-small', 0, 20, { label: 'entrance-hall' });                  // 1 the hall
await w.place('d', 'gate-door', 0, 25.9, { rot: 180, label: 'front-door' });          // 2 the door you came through
await w.place('d', 'template-detail', -3, 22, { label: 'hall-rubble' });

// --- North spine: hall -> crossroads -> great room -----------------------------
await w.place('d', 'corridor', 0, 14, { rot: 90 });
await w.place('d', 'gate', 0, 10, { rot: 0, label: 'iron-arch' });                    // 3 the arch
await w.place('d', 'corridor', 0, 10, { rot: 90 });
await w.place('d', 'corridor-intersection', 0, 6, { label: 'crossroads' });           // 4 the crossroads
await w.place('d', 'room-large', 0, -8, { label: 'great-room' });                     // 5 the great room
await w.place('d', 'template-detail', 0, -8, { s: 1.5, label: 'centre-pillar' });     // 6 the pillar
await w.place('d', 'stairs', 0, -20.5, { rot: 180, label: 'stairs-down' });           // 7 the stair

// --- East arm: the cell behind bars --------------------------------------------
await w.place('d', 'corridor', 4, 6);
await w.place('d', 'gate-metal-bars', 6.6, 6, { rot: 90, label: 'cell-bars' });       // 8 the bars
await w.place('d', 'corridor', 8, 6);
await w.place('d', 'room-small-variation', 18, 6, { label: 'cell' });                 // 9 the cell

// --- West arm: the treasury behind a windowed door ------------------------------
await w.place('d', 'corridor', -4, 6);
await w.place('d', 'gate-door-window', -6.6, 6, { rot: 90, label: 'treasury-door' }); // 10 the door
await w.place('d', 'corridor', -8, 6);
await w.place('d', 'room-wide-variation', -20, 6, { label: 'treasury' });             // 11 the treasury
await w.place('d', 'template-detail', -20, 6, { s: 1.2, label: 'hoard' });            // 12 the hoard

// --- A side gallery off the great room (west) -----------------------------------
await w.place('d', 'corridor', -12, -8);
await w.place('d', 'corridor', -16, -8);
await w.place('d', 'room-corner', -26, -8, { label: 'gallery' });                     // 13 the gallery
await w.place('d', 'template-detail', -26, -11, { label: 'gallery-relic' });

await w.write(out);
