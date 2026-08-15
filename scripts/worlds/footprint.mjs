// ASCII top-down map of a piece's WALL geometry (vertices between y=1.5 and 3.5),
// so you can see where the doorways are. Usage: footprint.mjs <glb...>
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const COLS = 40;
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
  const rows = Math.max(8, Math.round((COLS * d) / w / 2));
  const grid = Array.from({ length: rows }, () => new Array(COLS).fill(0));
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const a = prim.getAttribute('POSITION').getArray();
    for (let i = 0; i < a.length; i += 3) {
      if (a[i+1] < 1.5 || a[i+1] > 3.5) continue;
      const cx = Math.min(COLS-1, Math.floor(((a[i] - b.min[0]) / w) * COLS));
      const cz = Math.min(rows-1, Math.floor(((a[i+2] - b.min[2]) / d) * rows));
      grid[cz][cx]++;
    }
  }
  console.log(`${f.split('/').pop()}  x:${b.min[0].toFixed(1)}..${b.max[0].toFixed(1)}  z:${b.min[2].toFixed(1)}..${b.max[2].toFixed(1)}   (rows top = z min = "north")`);
  for (const row of grid) console.log('  ' + row.map(c => (c ? '#' : '.')).join(''));
}
