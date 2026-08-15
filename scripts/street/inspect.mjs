import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import { readdirSync } from 'node:fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const dir of process.argv.slice(2)) {
  for (const f of readdirSync(dir).filter(f=>f.endsWith('.glb'))) {
    const doc = await io.read(`${dir}/${f}`);
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
    const b = getBounds(scene);
    const tex = doc.getRoot().listTextures().map(t=>`${t.getURI()||'embedded'}:${t.getMimeType()}`).join(',');
    const size = b.max.map((v,i)=>(v-b.min[i]).toFixed(2)).join('x');
    console.log(f.padEnd(34), 'size', size.padEnd(18), 'min', b.min.map(v=>v.toFixed(2)).join(','), 'tex', tex, 'mats', doc.getRoot().listMaterials().length);
  }
}
