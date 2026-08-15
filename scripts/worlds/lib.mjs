/**
 * Shared helpers for baking sample worlds from Kenney's CC0 kits into a single GLB.
 * Each world is a small layout file (street.mjs, cave.mjs, …) that calls these.
 *
 * Kits are read from "<kitsDir>/<kit-folder>/Models/GLB format/*.glb". Pieces are
 * loaded once and instanced; a per-instance material swap gives colour variations.
 */
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, dedup, prune, unpartition } from '@gltf-transform/functions';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const DEG = Math.PI / 180;
export const quatY = (deg) => { const h = (deg * DEG) / 2; return [0, Math.sin(h), 0, Math.cos(h)]; };

/** sRGB hex ('#rrggbb') -> linear RGBA for a glTF baseColorFactor. */
export function hexToLinear(hex, alpha = 1) {
  const c = [0, 1, 2].map((i) => Math.pow(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255, 2.2));
  return [...c, alpha];
}

export class World {
  /**
   * @param kitsDir folder holding the unzipped Kenney kits
   * @param kits    alias -> kit folder name, e.g. { sub: 'city-kit-suburban' }
   * @param scale   uniform scale applied to the whole world (kit units -> metres)
   */
  constructor(kitsDir, kits, { scale = 1, name = 'world' } = {}) {
    this.kitsDir = kitsDir;
    this.kits = {};
    for (const [alias, folder] of Object.entries(kits)) {
      const p = resolve(kitsDir, folder, 'Models', 'GLB format');
      if (!existsSync(p)) throw new Error(`missing kit: ${p}`);
      this.kits[alias] = { folder, glb: p, textures: resolve(kitsDir, folder, 'Models', 'Textures') };
    }
    this.io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    this.doc = new Document();
    this.root = this.doc.getRoot();
    this.scene = this.doc.createScene(name);
    this.world = this.doc.createNode('world').setScale([scale, scale, scale]);
    this.scene.addChild(this.world);
    this.meshCache = new Map();
    this.variantMeshes = new Map();
    this.varMaterials = new Map();
  }

  async piece(kit, name) {
    const key = `${kit}/${name}`;
    if (this.meshCache.has(key)) return this.meshCache.get(key);
    const src = await this.io.read(resolve(this.kits[kit].glb, `${name}.glb`));
    const map = mergeDocuments(this.doc, src);
    const copied = map.get(src.getRoot().listScenes()[0]);
    let mesh = null;
    const visit = (n) => { if (!mesh && n.getMesh()) mesh = n.getMesh(); n.listChildren().forEach(visit); };
    copied.listChildren().forEach(visit);
    copied.listChildren().forEach((c) => c.dispose());
    copied.dispose();
    if (!mesh) throw new Error(`no mesh in ${key}`);
    mesh.setName(key);
    this.meshCache.set(key, mesh);
    return mesh;
  }

  /** Material using "<kit>/Models/Textures/variation-<letter>.png" instead of the default colormap. */
  variationMaterial(kit, letter, baseMat) {
    const key = `${kit}/${letter}`;
    if (this.varMaterials.has(key)) return this.varMaterials.get(key);
    const tex = this.doc.createTexture(key)
      .setImage(readFileSync(resolve(this.kits[kit].textures, `variation-${letter}.png`)))
      .setMimeType('image/png');
    const mat = baseMat.clone().setName(key).setBaseColorTexture(tex);
    this.varMaterials.set(key, mat);
    return mat;
  }

  withVariation(kit, mesh, letter) {
    if (!letter) return mesh;
    const key = `${mesh.getName()}#${letter}`;
    if (this.variantMeshes.has(key)) return this.variantMeshes.get(key);
    const clone = mesh.clone();
    for (const prim of clone.listPrimitives()) prim.setMaterial(this.variationMaterial(kit, letter, prim.getMaterial()));
    this.variantMeshes.set(key, clone);
    return clone;
  }

  /** Place one instance. x/z in kit units (before world scale); rot in degrees about Y. */
  async place(kit, name, x, z, { rot = 0, y = 0, s = 1, v = null, label = null } = {}) {
    const mesh = this.withVariation(kit, await this.piece(kit, name), v);
    const node = this.doc.createNode(label ?? name).setMesh(mesh)
      .setTranslation([x, y, z]).setRotation(quatY(rot)).setScale([s, s, s]);
    this.world.addChild(node);
    return node;
  }

  /** A flat coloured rectangle (ground, lawn, water…) from (x0,z0) to (x1,z1) at height y. */
  slab(name, x0, z0, x1, z1, hex, y = -0.004) {
    const mat = this.doc.createMaterial(name).setBaseColorFactor(hexToLinear(hex)).setRoughnessFactor(1).setMetallicFactor(0);
    const buf = this.root.listBuffers()[0] ?? this.doc.createBuffer();
    const pos = this.doc.createAccessor().setType('VEC3').setBuffer(buf)
      .setArray(new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]));
    const nrm = this.doc.createAccessor().setType('VEC3').setBuffer(buf)
      .setArray(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]));
    const idx = this.doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint16Array([0, 2, 1, 0, 3, 2]));
    const prim = this.doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nrm).setIndices(idx).setMaterial(mat);
    const mesh = this.doc.createMesh(name).addPrimitive(prim);
    this.world.addChild(this.doc.createNode(name).setMesh(mesh));
  }

  async write(outPath, copyright) {
    await this.doc.transform(dedup(), prune(), unpartition()); // GLB wants a single buffer
    this.root.setDefaultScene(this.scene);
    this.root.getAsset().generator = 'simon-says/scripts/worlds';
    this.root.getAsset().copyright = copyright ?? 'Assets: Kenney (kenney.nl), CC0. Layout: Simon Says contributors, CC0.';
    await this.io.write(outPath, this.doc);
    const mb = (statSync(outPath).size / 1e6).toFixed(2);
    console.log(`wrote ${outPath} (${mb} MB, ${this.root.listNodes().length} nodes, ${this.root.listMeshes().length} meshes)`);
  }
}

/** CLI boilerplate shared by every layout file: `node <layout>.mjs <kits-dir> [out.glb]`. */
export function cli(defaultOut) {
  const [kitsDir, out = defaultOut] = process.argv.slice(2);
  if (!kitsDir) { console.error(`usage: node ${process.argv[1].split('/').pop()} <kits-dir> [out.glb]`); process.exit(1); }
  return { kitsDir, out };
}
