/**
 * Bake "Simon's Street" — the bright default sample world — from Kenney's CC0 kits.
 *
 *   node scripts/street/build.mjs <kits-dir> [out.glb]
 *
 * <kits-dir> holds the three unzipped Kenney kits (kenney.nl, CC0):
 *   city-kit-suburban/  city-kit-roads/  city-kit-commercial/
 * Only the "Models/GLB format" folders (and the suburban kit's Models/Textures
 * variations) are read. Output is a single self-contained .glb, ~1–2 MB.
 *
 * The layout below is data: a list of placements in tile units (1 tile = one
 * road tile), scaled by SCALE into metres so a two-storey house is ~7 m tall.
 */
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, dedup, prune, unpartition } from '@gltf-transform/functions';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [kitsDir, outPath = 'public/assets/samples/street/SimonsStreet.glb'] = process.argv.slice(2);
if (!kitsDir) { console.error('usage: build.mjs <kits-dir> [out.glb]'); process.exit(1); }

const SCALE = 6;
const KITS = {
  sub: resolve(kitsDir, 'city-kit-suburban/Models/GLB format'),
  road: resolve(kitsDir, 'city-kit-roads/Models/GLB format'),
  com: resolve(kitsDir, 'city-kit-commercial/Models/GLB format'),
};
const VARIATIONS = resolve(kitsDir, 'city-kit-suburban/Models/Textures'); // variation-{a,b,c}.png
for (const p of [...Object.values(KITS), VARIATIONS]) if (!existsSync(p)) { console.error('missing', p); process.exit(1); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = new Document();
const root = doc.getRoot();
const scene = doc.createScene('SimonsStreet');
const world = doc.createNode('world').setScale([SCALE, SCALE, SCALE]);
scene.addChild(world);

// --- piece cache: kit -> name -> Mesh (already merged into `doc`) --------------
const meshCache = new Map();
async function piece(kit, name) {
  const key = `${kit}/${name}`;
  if (meshCache.has(key)) return meshCache.get(key);
  const src = await io.read(resolve(KITS[kit], `${name}.glb`));
  const map = mergeDocuments(doc, src);
  const srcScene = src.getRoot().listScenes()[0];
  const copied = map.get(srcScene);
  // Kenney pieces are a single mesh under one node; grab the first mesh we find.
  let mesh = null;
  const visit = (n) => { if (!mesh && n.getMesh()) mesh = n.getMesh(); n.listChildren().forEach(visit); };
  copied.listChildren().forEach(visit);
  copied.listChildren().forEach((c) => c.dispose());
  copied.dispose();
  if (!mesh) throw new Error(`no mesh in ${key}`);
  meshCache.set(key, mesh);
  return mesh;
}

// --- roof-colour variations (suburban kit only) -------------------------------
const varMaterials = new Map(); // 'a'|'b'|'c' -> Material
function variationMaterial(letter, baseMat) {
  if (varMaterials.has(letter)) return varMaterials.get(letter);
  const tex = doc.createTexture(`variation-${letter}`)
    .setImage(readFileSync(resolve(VARIATIONS, `variation-${letter}.png`)))
    .setMimeType('image/png');
  const mat = baseMat.clone().setName(`suburban-${letter}`).setBaseColorTexture(tex);
  varMaterials.set(letter, mat);
  return mat;
}
const variantMeshes = new Map();
function withVariation(mesh, letter) {
  if (!letter) return mesh;
  const key = `${mesh.getName()}#${letter}`;
  if (variantMeshes.has(key)) return variantMeshes.get(key);
  const clone = mesh.clone();
  for (const prim of clone.listPrimitives()) prim.setMaterial(variationMaterial(letter, prim.getMaterial()));
  variantMeshes.set(key, clone);
  return clone;
}

// --- placement ------------------------------------------------------------------
const DEG = Math.PI / 180;
function quatY(deg) { const h = deg * DEG / 2; return [0, Math.sin(h), 0, Math.cos(h)]; }
async function place(kit, name, x, z, { rot = 0, y = 0, s = 1, v = null, label = null } = {}) {
  const mesh = withVariation(await piece(kit, name), v);
  const node = doc.createNode(label ?? name).setMesh(mesh)
    .setTranslation([x, y, z]).setRotation(quatY(rot)).setScale([s, s, s]);
  world.addChild(node);
  return node;
}

// --- flat coloured ground slabs (grass lots, park lawn) ------------------------
function slab(name, x0, z0, x1, z1, hex, y = -0.004) {
  const [r, g, b] = [0, 1, 2].map((i) => Math.pow(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255, 2.2)); // sRGB -> linear
  const mat = doc.createMaterial(name).setBaseColorFactor([r, g, b, 1]).setRoughnessFactor(1).setMetallicFactor(0);
  const buf = root.listBuffers()[0] ?? doc.createBuffer();
  const pos = doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array([
    x0, y, z0,  x1, y, z0,  x1, y, z1,  x0, y, z1,
  ]));
  const nrm = doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array([0,1,0, 0,1,0, 0,1,0, 0,1,0]));
  const idx = doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint16Array([0, 2, 1, 0, 3, 2]));
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nrm).setIndices(idx).setMaterial(mat);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  world.addChild(doc.createNode(name).setMesh(mesh));
}

// =============================================================================
// LAYOUT — tile units. Main street runs along X at z=0 (x = -1 … 9), a side
// street runs south (+z) from x=4, ending at the park. Roundabout at the east end.
// =============================================================================
const GRASS = '#8fcf6a';
const LAWN = '#a6dc7e';
const PAVE = '#c9ccd4';

// Ground: one big grass slab, lighter lawn for the park.
slab('grass', -3, -8, 13, 8, GRASS); // symmetric about the street: the app spawns at the bounds centre
slab('park-lawn', 2.5, 4.5, 5.5, 7.5, LAWN, -0.003);
slab('plaza', 5, 0.55, 9, 1.6, PAVE, -0.003); // café / school forecourt

// Roads.
for (let x = 0; x <= 9; x++) {
  if (x === 4) continue;
  await place('road', x === 2 ? 'road-crossing' : 'road-straight', x, 0, { rot: 0 });
}
await place('road', 'road-end', -1, 0, { rot: 0 });
await place('road', 'road-intersection', 4, 0, { rot: 0 });
for (let z = 1; z <= 3; z++) await place('road', 'road-straight', 4, z, { rot: 90 });
await place('road', 'road-end-round', 4, 4, { rot: 90 });
await place('road', 'road-roundabout', 11, 0, { rot: 90 });
await place('road', 'road-end', 13, 0, { rot: 180 });
await place('road', 'road-straight', 12.5, 0, { rot: 0 }); // stub between roundabout and end (overlaps ok)

// Street lights along the north kerb.
for (const x of [-0.5, 1.5, 3.5, 5.5, 7.5]) await place('road', 'light-curved', x, -0.55, { rot: 180 });
for (const x of [0.5, 2.5, 6.5, 8.5]) await place('road', 'light-curved', x, 0.55, { rot: 0 });

// North side, facing the street (south).  Each lot: house + driveway + trees.
const N = -1.35, NF = 180; // z of house centres, rotation to face the road
await place('sub', 'building-type-b', 0, N, { rot: NF, v: 'a', label: 'home' });          // 1 blue home
await place('sub', 'driveway-long', 0.75, -0.72, { rot: 0 });
await place('sub', 'tree-large', -1.1, N, {});
await place('sub', 'building-type-h', 2, N, { rot: NF, label: 'solar-house' });          // 2 solar roof
await place('sub', 'fence-1x3', 2, -0.7, { rot: 0 });
await place('sub', 'tree-small', 3.1, -1.6, {});
await place('sub', 'building-type-c', 4, N, { rot: NF, label: 'green-house' });        // infill opposite the junction
await place('sub', 'path-long', 4, -0.75, {});
await place('com', 'building-c', 6, N, { rot: NF, label: 'corner-shop' });               // 3 corner shop
await place('com', 'detail-awning', 5.85, -0.9, { rot: NF, y: 0.32 });
await place('com', 'building-m', 8.2, N - 0.45, { rot: NF, label: 'tower' });             // 4 the tower
await place('sub', 'planter', 7.3, -0.75, {});

// South side, facing north.
const S_ = 1.35, SF = 0;
await place('sub', 'building-type-o', 0, S_, { rot: SF, label: 'dark-house' });          // 5 dark modern
await place('sub', 'tree-large', -1.0, 1.4, {});
await place('sub', 'building-type-t', 2, S_ + 0.1, { rot: SF, v: 'b', label: 'garage-house' }); // 6 terracotta w/ garage
await place('sub', 'driveway-long', 2.6, 0.72, {});
await place('com', 'building-e', 6.2, S_ + 0.1, { rot: SF, label: 'cafe' });             // 7 café
await place('com', 'detail-parasol-a', 5.4, 0.85, {});
await place('com', 'detail-parasol-b', 5.9, 0.75, {});
await place('com', 'detail-parasol-a', 6.9, 0.8, {});
await place('com', 'building-j', 8.6, S_ + 0.25, { rot: SF, label: 'school' });          // 8 school
await place('sub', 'planter', 7.6, 0.75, {});
await place('sub', 'planter', 9.6, 0.75, {});

// Side street lots (facing the side street, i.e. ±x).
await place('sub', 'building-type-f', 2.7, 2.4, { rot: 270, v: 'c', label: 'grey-house' }); // 9 grey house
await place('sub', 'fence-2x2', 2.7, 3.4, {});
await place('sub', 'building-type-n', 5.4, 2.4, { rot: 90, v: 'a', label: 'big-blue-house' }); // 10 big blue
await place('sub', 'tree-small', 5.4, 3.5, {});
await place('sub', 'tree-small', 2.7, 1.3, {});

// The park at the end of the side street.
await place('sub', 'fence-3x3', 4, 6, { s: 2.2 });
await place('sub', 'tree-large', 3.2, 5.3, { s: 1.3 });
await place('sub', 'tree-large', 4.9, 6.7, { s: 1.5 });
await place('sub', 'tree-small', 4.8, 5.2, {});
await place('sub', 'tree-small', 3.1, 6.8, {});
await place('sub', 'planter', 4, 6, { s: 1.4, label: 'park-planter' });                  // 11 park
await place('sub', 'path-stones-long', 4, 5.0, {});
await place('com', 'detail-awning-wide', 4, 7.2, { rot: 180, y: 0.05, label: 'bandstand' });

// Roundabout centre-piece: one big tree.
await place('sub', 'tree-large', 11, 0, { s: 2.4, label: 'round-tree' });               // 12 roundabout

// A few extra background houses so it isn't a lone row.
await place('sub', 'building-type-k', -2.2, -1.4, { rot: NF, v: 'b' });
await place('sub', 'building-type-r', -2.2, 1.4, { rot: SF, v: 'c' });
await place('sub', 'building-type-e', 10.6, -2.4, { rot: NF, v: 'a' });
await place('sub', 'building-type-d', 10.8, 2.4, { rot: SF, v: 'b' });
for (const [x, z] of [[-2.5, -3], [1, -3], [4, -3], [7.5, -3], [12, -3], [-1, 3.2], [8, 3.4], [11, 4], [7, 5.5], [1, 5.5]]) {
  await place('sub', 'tree-large', x, z, { s: 1.1 });
}

// --- finish ---------------------------------------------------------------------
await doc.transform(dedup(), prune(), unpartition()); // GLB wants a single buffer
root.setDefaultScene(scene);
root.getAsset().generator = 'simon-says/scripts/street/build.mjs';
root.getAsset().copyright = 'Assets: Kenney (kenney.nl), CC0. Layout: Simon Says contributors, CC0.';
await io.write(outPath, doc);
const bytes = (await import('node:fs')).statSync(outPath).size;
console.log(`wrote ${outPath} (${(bytes / 1e6).toFixed(2)} MB, ${root.listNodes().length} nodes, ${root.listMeshes().length} meshes)`);
