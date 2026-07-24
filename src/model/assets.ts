/**
 * A cross-cutting view of every image/mesh used anywhere in a world — the data
 * behind the Assets library. Assets stay embedded per-element (no central
 * registry); this just walks the palace and dedupes by data URL so you can see,
 * download, or reuse anything you've made or uploaded.
 */
import type { Attachment, Palace } from './palace';

export interface AssetRef {
  src: string;
  type: 'image' | 'mesh';
  /** How many places reference this exact asset. */
  uses: number;
  /** A hint at where it first showed up (locus label, "decor", a portal name…). */
  label: string;
}

export function collectAssets(palace: Palace): AssetRef[] {
  const map = new Map<string, { type: 'image' | 'mesh'; uses: number; label: string }>();
  const add = (src: string | null | undefined, type: 'image' | 'mesh', label: string): void => {
    if (!src) return;
    const ex = map.get(src);
    if (ex) ex.uses++;
    else map.set(src, { type, uses: 1, label });
  };

  for (const l of palace.loci) {
    const where = l.label || `Locus ${l.order}`;
    add(l.image_2d, 'image', where);
    add(l.mesh_3d, 'mesh', where);
    for (const g of l.gallery ?? []) add(g.src, g.type, where);
    for (const p of l.props ?? []) {
      if (p.kind !== 'text') add(p.src, p.kind, `${where} · prop`);
      for (const g of p.gallery ?? []) add(g.src, g.type, `${where} · prop`);
    }
  }
  for (const d of palace.decor ?? []) {
    if (d.kind !== 'text') add(d.src, d.kind, 'Decor');
    for (const g of d.gallery ?? []) add(g.src, g.type, 'Decor');
  }
  for (const p of palace.portals ?? []) {
    const where = p.label ? `Portal ${p.label}` : 'Portal';
    if (p.kind) add(p.src, p.kind, where);
    for (const g of p.gallery ?? []) add(g.src, g.type, where);
  }

  return [...map.entries()].map(([src, v]) => ({ src, ...v }));
}

/**
 * Swap every reference to one asset for another, everywhere in the world — so
 * reusing the same image/mesh in six places and then replacing it updates all six.
 * Handles a type change (image<->mesh) by moving to the right slot/kind.
 */
export function replaceAssetEverywhere(palace: Palace, oldSrc: string, newSrc: string, newType: 'image' | 'mesh'): number {
  let n = 0;
  const swapGallery = (gal?: Attachment[]): void => {
    for (const g of gal ?? []) {
      if (g.src === oldSrc) {
        g.src = newSrc;
        g.type = newType;
        n++;
      }
    }
  };

  for (const l of palace.loci) {
    if (l.image_2d === oldSrc) {
      if (newType === 'image') l.image_2d = newSrc;
      else {
        l.image_2d = null;
        l.mesh_3d = newSrc;
      }
      n++;
    }
    if (l.mesh_3d === oldSrc) {
      if (newType === 'mesh') l.mesh_3d = newSrc;
      else {
        l.mesh_3d = null;
        l.image_2d = newSrc;
      }
      n++;
    }
    swapGallery(l.gallery);
    for (const p of l.props ?? []) {
      if (p.src === oldSrc) {
        p.src = newSrc;
        p.kind = newType;
        if (newType === 'mesh') p.rotation = p.rotation ?? [0, 0, 0];
        n++;
      }
      swapGallery(p.gallery);
    }
  }
  for (const d of palace.decor ?? []) {
    if (d.src === oldSrc) {
      d.src = newSrc;
      d.kind = newType;
      if (newType === 'mesh') d.rotation = d.rotation ?? [0, 0, 0];
      n++;
    }
    swapGallery(d.gallery);
  }
  for (const p of palace.portals ?? []) {
    if (p.src === oldSrc) {
      p.src = newSrc;
      p.kind = newType;
      if (newType === 'mesh') p.rotation = p.rotation ?? [0, 0, 0];
      n++;
    }
    swapGallery(p.gallery);
  }
  return n;
}
