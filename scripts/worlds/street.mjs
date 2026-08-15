/**
 * Simon's Street — the bright default sample world. Kenney City Kits (Suburban /
 * Roads / Commercial), CC0.   node scripts/worlds/street.mjs <kits-dir> [out.glb]
 *
 * Layout is data: tile units (1 tile = one road tile), scaled ×6 into metres so a
 * two-storey house is ~7 m tall. Rooms/kits: see lib.mjs.
 */
import { World, cli } from './lib.mjs';

const { kitsDir, out } = cli('public/assets/samples/street/SimonsStreet.glb');
const w = new World(kitsDir, { sub: 'city-kit-suburban', road: 'city-kit-roads', com: 'city-kit-commercial' }, { scale: 6, name: 'SimonsStreet' });

// =============================================================================
// LAYOUT — tile units. Main street runs along X at z=0 (x = -1 … 9), a side
// street runs south (+z) from x=4, ending at the park. Roundabout at the east end.
// =============================================================================
const GRASS = '#8fcf6a';
const LAWN = '#a6dc7e';
const PAVE = '#c9ccd4';

// Ground: one big grass slab, lighter lawn for the park.
w.slab('grass', -3, -8, 13, 8, GRASS); // symmetric about the street: the app spawns at the bounds centre
w.slab('park-lawn', 2.5, 4.5, 5.5, 7.5, LAWN, -0.003);
w.slab('plaza', 5, 0.55, 9, 1.6, PAVE, -0.003); // café / school forecourt

// Roads.
for (let x = 0; x <= 9; x++) {
  if (x === 4) continue;
  await w.place('road', x === 2 ? 'road-crossing' : 'road-straight', x, 0, { rot: 0 });
}
await w.place('road', 'road-end', -1, 0, { rot: 0 });
await w.place('road', 'road-intersection', 4, 0, { rot: 0 });
for (let z = 1; z <= 3; z++) await w.place('road', 'road-straight', 4, z, { rot: 90 });
await w.place('road', 'road-end-round', 4, 4, { rot: 90 });
await w.place('road', 'road-roundabout', 11, 0, { rot: 90 });
await w.place('road', 'road-end', 13, 0, { rot: 180 });
await w.place('road', 'road-straight', 12.5, 0, { rot: 0 }); // stub between roundabout and end (overlaps ok)

// Street lights along the north kerb.
for (const x of [-0.5, 1.5, 3.5, 5.5, 7.5]) await w.place('road', 'light-curved', x, -0.55, { rot: 180 });
for (const x of [0.5, 2.5, 6.5, 8.5]) await w.place('road', 'light-curved', x, 0.55, { rot: 0 });

// North side, facing the street (south).  Each lot: house + driveway + trees.
const N = -1.35, NF = 180; // z of house centres, rotation to face the road
await w.place('sub', 'building-type-b', 0, N, { rot: NF, v: 'a', label: 'home' });          // 1 blue home
await w.place('sub', 'driveway-long', 0.75, -0.72, { rot: 0 });
await w.place('sub', 'tree-large', -1.1, N, {});
await w.place('sub', 'building-type-h', 2, N, { rot: NF, label: 'solar-house' });          // 2 solar roof
await w.place('sub', 'fence-1x3', 2, -0.7, { rot: 0 });
await w.place('sub', 'tree-small', 3.1, -1.6, {});
await w.place('sub', 'building-type-c', 4, N, { rot: NF, label: 'green-house' });        // infill opposite the junction
await w.place('sub', 'path-long', 4, -0.75, {});
await w.place('com', 'building-c', 6, N, { rot: NF, label: 'corner-shop' });               // 3 corner shop
await w.place('com', 'detail-awning', 5.85, -0.9, { rot: NF, y: 0.32 });
await w.place('com', 'building-m', 8.2, N - 0.45, { rot: NF, label: 'tower' });             // 4 the tower
await w.place('sub', 'planter', 7.3, -0.75, {});

// South side, facing north.
const S_ = 1.35, SF = 0;
await w.place('sub', 'building-type-o', 0, S_, { rot: SF, label: 'dark-house' });          // 5 dark modern
await w.place('sub', 'tree-large', -1.0, 1.4, {});
await w.place('sub', 'building-type-t', 2, S_ + 0.1, { rot: SF, v: 'b', label: 'garage-house' }); // 6 terracotta w/ garage
await w.place('sub', 'driveway-long', 2.6, 0.72, {});
await w.place('com', 'building-e', 6.2, S_ + 0.1, { rot: SF, label: 'cafe' });             // 7 café
await w.place('com', 'detail-parasol-a', 5.4, 0.85, {});
await w.place('com', 'detail-parasol-b', 5.9, 0.75, {});
await w.place('com', 'detail-parasol-a', 6.9, 0.8, {});
await w.place('com', 'building-j', 8.6, S_ + 0.25, { rot: SF, label: 'school' });          // 8 school
await w.place('sub', 'planter', 7.6, 0.75, {});
await w.place('sub', 'planter', 9.6, 0.75, {});

// Side street lots (facing the side street, i.e. ±x).
await w.place('sub', 'building-type-f', 2.7, 2.4, { rot: 270, v: 'c', label: 'grey-house' }); // 9 grey house
await w.place('sub', 'fence-2x2', 2.7, 3.4, {});
await w.place('sub', 'building-type-n', 5.4, 2.4, { rot: 90, v: 'a', label: 'big-blue-house' }); // 10 big blue
await w.place('sub', 'tree-small', 5.4, 3.5, {});
await w.place('sub', 'tree-small', 2.7, 1.3, {});

// The park at the end of the side street.
await w.place('sub', 'fence-3x3', 4, 6, { s: 2.2 });
await w.place('sub', 'tree-large', 3.2, 5.3, { s: 1.3 });
await w.place('sub', 'tree-large', 4.9, 6.7, { s: 1.5 });
await w.place('sub', 'tree-small', 4.8, 5.2, {});
await w.place('sub', 'tree-small', 3.1, 6.8, {});
await w.place('sub', 'planter', 4, 6, { s: 1.4, label: 'park-planter' });                  // 11 park
await w.place('sub', 'path-stones-long', 4, 5.0, {});
await w.place('com', 'detail-awning-wide', 4, 7.2, { rot: 180, y: 0.05, label: 'bandstand' });

// Roundabout centre-piece: one big tree.
await w.place('sub', 'tree-large', 11, 0, { s: 2.4, label: 'round-tree' });               // 12 roundabout

// A few extra background houses so it isn't a lone row.
await w.place('sub', 'building-type-k', -2.2, -1.4, { rot: NF, v: 'b' });
await w.place('sub', 'building-type-r', -2.2, 1.4, { rot: SF, v: 'c' });
await w.place('sub', 'building-type-e', 10.6, -2.4, { rot: NF, v: 'a' });
await w.place('sub', 'building-type-d', 10.8, 2.4, { rot: SF, v: 'b' });
for (const [x, z] of [[-2.5, -3], [1, -3], [4, -3], [7.5, -3], [12, -3], [-1, 3.2], [8, 3.4], [11, 4], [7, 5.5], [1, 5.5]]) {
  await w.place('sub', 'tree-large', x, z, { s: 1.1 });
}


await w.write(out);
