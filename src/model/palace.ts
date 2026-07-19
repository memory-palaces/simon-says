/**
 * The palace data model. This is the authoring format described in SPEC.md — a
 * JSON manifest that references geometry by file and stores loci in ASSET-LOCAL
 * coordinates, never world space. That anchoring rule is the whole reason the tool
 * is iterative: re-export an improved GLB, swap it in, and every locus stays put.
 *
 * These types and helpers are pure data — no three.js here. World<->local
 * conversion lives next to the renderer (see engine/Loci.ts), because only the
 * renderer knows an asset's current world transform.
 */

export type Vec3 = [number, number, number];
/** Column-major 4x4, glTF/three convention. Length 16. */
export type Mat4 = number[];

export interface Asset {
  id: string;
  /** Path or filename the geometry came from. May be unresolved after load. */
  file: string;
  transform: Mat4;
}

export interface Locus {
  id: string;
  /** 1-based position in the route. The route is linear: review walks 1 -> 2 -> 3. */
  order: number;
  /** The physical location cue, e.g. "Kitchen island, north corner". */
  label: string;
  /** Which asset this locus is anchored to; its coords are local to that asset. */
  asset_id: string;
  local_position: Vec3;
  local_normal: Vec3;
  /** The bizarre mnemonic image — WRITTEN BY THE USER. The AI only ever renders it. */
  image_prompt: string;
  image_2d: string | null;
  mesh_3d: string | null;
  /**
   * A nested palace embedded inline (self-contained). Entering it is a scene
   * transition — a full-size space can live inside a fridge. Non-Euclidean is fine.
   */
  child_palace: Palace | null;
  /** ISO timestamp of the last review, or null. Left in the model for v2 SRS. */
  last_reviewed: string | null;
}

export interface Zone {
  id: string;
  name: string;
}

/** The look of the empty space around the geometry. Solid colour for now. */
export interface Environment {
  /** Background + fog colour as a #rrggbb hex string. */
  background: string;
  /** Global light multiplier (1 = default). Brightens dark interiors. */
  brightness?: number;
  /** Player scale for this world (1 = human). <1 = tiny (space feels huge), >1 = giant. */
  playerScale?: number;
}

/** Which generation pipeline THIS world uses. Credentials live in app settings. */
export interface WorldGeneration {
  backendId: string;
  /** Optional style-preset id appended to renders (a rendering modifier, not the mnemonic). */
  style?: string;
}

export interface Palace {
  version: 1;
  name: string;
  assets: Asset[];
  loci: Locus[];
  zones: Zone[];
  /** Optional so older palace files still load; defaults applied on read. */
  environment?: Environment;
  /** Which image pipeline this world uses (credentials are app-global). */
  generation?: WorldGeneration;
}

/** A dark slate instead of pure black — less "abyss", still lets geometry pop. */
export const DEFAULT_BACKGROUND = '#20242c';

export const IDENTITY_MAT4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export const DEFAULT_ASSET_ID = 'a1';

function uid(prefix: string): string {
  // crypto.randomUUID is available in every browser we target; fall back just in case.
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}_${rand}`;
}

export function createEmptyPalace(name = 'Untitled palace'): Palace {
  return { version: 1, name, assets: [], loci: [], zones: [], environment: { background: DEFAULT_BACKGROUND } };
}

/** Register (or replace) the geometry asset a palace's loci are anchored to. */
export function setAsset(palace: Palace, file: string, id = DEFAULT_ASSET_ID, transform = IDENTITY_MAT4): void {
  const existing = palace.assets.find((a) => a.id === id);
  if (existing) {
    existing.file = file;
    existing.transform = transform;
  } else {
    palace.assets.push({ id, file, transform });
  }
}

/** Append a new locus at the end of the route. Coordinates are asset-local. */
export function addLocus(
  palace: Palace,
  localPosition: Vec3,
  localNormal: Vec3,
  assetId = DEFAULT_ASSET_ID,
): Locus {
  const locus: Locus = {
    id: uid('l'),
    order: palace.loci.length + 1,
    label: '',
    asset_id: assetId,
    local_position: localPosition,
    local_normal: localNormal,
    image_prompt: '',
    image_2d: null,
    mesh_3d: null,
    child_palace: null,
    last_reviewed: null,
  };
  palace.loci.push(locus);
  renumber(palace);
  return locus;
}

export function removeLocus(palace: Palace, id: string): void {
  palace.loci = palace.loci.filter((l) => l.id !== id);
  renumber(palace);
}

/** Move a locus up (-1) or down (+1) in the route order. */
export function reorderLocus(palace: Palace, id: string, direction: -1 | 1): void {
  const ordered = lociInOrder(palace);
  const i = ordered.findIndex((l) => l.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= ordered.length) return;
  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  ordered.forEach((l, idx) => (l.order = idx + 1));
  palace.loci = ordered;
}

/** Loci sorted by their route order. */
export function lociInOrder(palace: Palace): Locus[] {
  return [...palace.loci].sort((a, b) => a.order - b.order);
}

/** Collapse order values to a clean 1..N after add/remove. */
export function renumber(palace: Palace): void {
  lociInOrder(palace).forEach((l, idx) => (l.order = idx + 1));
}

/** Basic shape check when loading untrusted JSON. Throws on obvious mismatch. */
export function assertPalace(data: unknown): asserts data is Palace {
  const p = data as Palace;
  if (!p || typeof p !== 'object') throw new Error('Not a palace file.');
  if (p.version !== 1) throw new Error(`Unsupported palace version: ${(p as { version?: unknown }).version}`);
  if (!Array.isArray(p.assets) || !Array.isArray(p.loci)) throw new Error('Palace file is missing assets or loci.');
}
