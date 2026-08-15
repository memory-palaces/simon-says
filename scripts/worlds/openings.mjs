// Print where each side of a modular piece has a gap in its wall (an opening),
// by histogramming wall vertices (y > 1) along each edge. Usage: openings.mjs <glb...>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const scene = doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const pts = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const arr = prim.getAttribute('POSITION').getArray();
    for (let i = 0; i < arr.length; i += 3) pts.push([arr[i], arr[i+1], arr[i+2]]);
  }
  // Note: ignores node transforms; Kenney pieces are single un-transformed meshes.
  const walls = pts.filter(p => p[1] > 1.0);
  const bins = 24, tol = 0.6;
  const line = (axis, fixedAxis, fixedVal) => {
    const lo = b.min[axis], hi = b.max[axis], w = (hi - lo) / bins;
    const h = new Array(bins).fill(0);
    for (const p of walls) if (Math.abs(p[fixedAxis] - fixedVal) < tol) h[Math.min(bins-1, Math.floor((p[axis]-lo)/w))]++;
    return h.map(c => c > 0 ? '#' : '.').join('');
  };
  console.log(f.split('/').pop(), `size ${b.max.map((v,i)=>(v-b.min[i]).toFixed(1)).join('x')}`);
  console.log('  north (z=min) x→ ', line(0, 2, b.min[2]));
  console.log('  south (z=max) x→ ', line(0, 2, b.max[2]));
  console.log('  west  (x=min) z→ ', line(2, 0, b.min[0]));
  console.log('  east  (x=max) z→ ', line(2, 0, b.max[0]));
}
