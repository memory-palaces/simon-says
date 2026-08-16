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
  /** Freeform notes: what this locus represents, how you got here, links — a knowledge repo. */
  notes?: string;
  image_2d: string | null;
  mesh_3d: string | null;
  /** Per-locus scale for the attached image/mesh (1 = default). Does NOT scale the orb. */
  object_scale?: number;
  /** Per-locus mesh rotation in degrees [x, y, z] (images are billboards, unaffected). */
  object_rotation?: Vec3;
  /**
   * Nudge the attached image/mesh off the surface, in metres, in the locus's own
   * frame: [right, up, out]. "out" is along the surface normal — the one you reach
   * for when a billboard is buried in the wall it's pinned to.
   */
  object_offset?: Vec3;
  /** Every image/mesh ever generated or attached here — rotate between them. */
  gallery?: Attachment[];
  /**
   * Extra elements composed around this locus to build a richer "scene" — text
   * captions, 2D billboards, or 3D props — each with its own offset/scale. They
   * belong to the locus: they move, hide, and delete with it. Not part of the
   * recall order (the locus is still the single thing you recall here).
   */
  props?: SceneProp[];
  /**
   * A nested palace embedded inline (self-contained). Entering it is a scene
   * transition — a full-size space can live inside a fridge. Non-Euclidean is fine.
   */
  child_palace: Palace | null;
  /** ISO timestamp of the last review, or null. Left in the model for v2 SRS. */
  last_reviewed: string | null;
}

/** One saved representation for a locus — a generated/attached image or mesh. */
export interface Attachment {
  type: 'image' | 'mesh';
  src: string;
}

/**
 * One element of a locus's scene. A `text` prop is a floating caption; an `image`
 * prop is a billboard; a `mesh` prop is a 3D object. Offsets are in the locus's
 * local frame: [right, up, out] in metres (out = along the surface normal).
 */
export interface SceneProp {
  id: string;
  kind: 'text' | 'image' | 'mesh';
  /** Caption text (kind 'text'). */
  text?: string;
  /** User-written prompt for the image/mesh (kind 'image'|'mesh'). AI only renders it. */
  image_prompt?: string;
  /** Image data URL ('image') or GLB data URL ('mesh'). */
  src?: string | null;
  offset?: Vec3;
  scale?: number;
  /** Mesh rotation in degrees [x,y,z] (billboards/text ignore it). */
  rotation?: Vec3;
  /** Version history for this prop's image/mesh — rotate between variants. */
  gallery?: Attachment[];
}

/** Add a scene prop of the given kind to a locus, staggered so props don't stack. */
export function addProp(locus: Locus, kind: SceneProp['kind']): SceneProp {
  if (!locus.props) locus.props = [];
  const n = locus.props.length;
  const side = n % 2 === 0 ? 1 : -1;
  const prop: SceneProp = {
    id: uid('sp'),
    kind,
    text: kind === 'text' ? '' : undefined,
    image_prompt: kind === 'text' ? undefined : '',
    src: null,
    offset: [0.8 * side * (1 + Math.floor(n / 2) * 0.7), 0.6, 0.5],
    scale: 1,
    rotation: kind === 'mesh' ? [0, 0, 0] : undefined,
  };
  locus.props.push(prop);
  return prop;
}

export function removeProp(locus: Locus, propId: string): void {
  if (locus.props) locus.props = locus.props.filter((p) => p.id !== propId);
}

/** Add a variant to a prop's/decor's gallery (deduped by src). */
export function addPropAttachment(target: { gallery?: Attachment[] }, att: Attachment): void {
  if (!target.gallery) target.gallery = [];
  if (!target.gallery.some((a) => a.type === att.type && a.src === att.src)) target.gallery.push(att);
}

/**
 * Free-standing decor: a scene element (text/image/mesh) placed anywhere on the
 * geometry for pure ambiance. Unlike a scene prop it belongs to no locus and is
 * not part of the recall route — it's set-dressing. Anchored in asset-local
 * coordinates like a locus/portal, so it survives a GLB swap.
 */
export interface Decor {
  id: string;
  asset_id: string;
  local_position: Vec3;
  local_normal: Vec3;
  kind: 'text' | 'image' | 'mesh';
  text?: string;
  image_prompt?: string;
  src?: string | null;
  scale?: number;
  rotation?: Vec3;
  gallery?: Attachment[];
}

export function addDecor(
  palace: Palace,
  kind: Decor['kind'],
  localPosition: Vec3,
  localNormal: Vec3,
  assetId = DEFAULT_ASSET_ID,
): Decor {
  const decor: Decor = {
    id: uid('d'),
    asset_id: assetId,
    local_position: localPosition,
    local_normal: localNormal,
    kind,
    text: kind === 'text' ? '' : undefined,
    image_prompt: kind === 'text' ? undefined : '',
    src: null,
    scale: 1,
    rotation: kind === 'mesh' ? [0, 0, 0] : undefined,
  };
  if (!palace.decor) palace.decor = [];
  palace.decor.push(decor);
  return decor;
}

export function removeDecor(palace: Palace, id: string): void {
  if (palace.decor) palace.decor = palace.decor.filter((d) => d.id !== id);
}

/** Add an attachment to a locus's gallery (deduped by src). */
export function addAttachment(locus: Locus, att: Attachment): void {
  if (!locus.gallery) locus.gallery = [];
  if (!locus.gallery.some((a) => a.type === att.type && a.src === att.src)) locus.gallery.push(att);
}

/**
 * A first-class portal: a placeable doorway that leads to another world. Not tied
 * to a locus — you can put one anywhere; place it beside a locus if you want to
 * associate them, but you don't have to.
 */
export interface Portal {
  id: string;
  asset_id: string;
  local_position: Vec3;
  local_normal: Vec3;
  label: string;
  /** The world this portal leads to (embedded), created lazily on first entry. */
  target: Palace | null;
  /** Optional visual shown at the doorway (besides the ring): an image or 3D model. */
  kind?: 'image' | 'mesh';
  image_prompt?: string;
  src?: string | null;
  scale?: number;
  rotation?: Vec3;
  gallery?: Attachment[];
}

export function addPortal(palace: Palace, localPosition: Vec3, localNormal: Vec3, assetId = DEFAULT_ASSET_ID): Portal {
  const portal: Portal = { id: uid('p'), asset_id: assetId, local_position: localPosition, local_normal: localNormal, label: '', target: null };
  if (!palace.portals) palace.portals = [];
  palace.portals.push(portal);
  return portal;
}

/**
 * Migrate the old model (a locus.child_palace) to first-class portals: each locus
 * that had a child becomes a portal at the same spot. Recurses into every target.
 */
export function migratePalace(palace: Palace): void {
  if (!palace.portals) palace.portals = [];
  for (const locus of palace.loci) {
    if (locus.child_palace) {
      palace.portals.push({
        id: uid('p'),
        asset_id: locus.asset_id,
        local_position: locus.local_position,
        local_normal: locus.local_normal,
        label: locus.label || 'Portal',
        target: locus.child_palace,
      });
      locus.child_palace = null;
    }
  }
  for (const portal of palace.portals) {
    if (portal.target) migratePalace(portal.target);
  }
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
  /** A gradient-sky pattern id (overrides the solid background when set). */
  pattern?: string;
  /**
   * Float each locus's mnemonic text in the world as a plaque above its marker
   * (above the image, when there is one). Undefined = on: most people never set up
   * image generation, so the words themselves are what they see in the palace.
   */
  captions?: boolean;
}

/** Cheerful vertical-gradient sky presets (top -> horizon). */
export const BACKGROUND_PATTERNS: Array<{ id: string; label: string; top: string; bottom: string }> = [
  { id: 'sky', label: 'Sky', top: '#7fb0e8', bottom: '#dfeaf5' },
  { id: 'sunset', label: 'Sunset', top: '#f28d6b', bottom: '#f6dcc4' },
  { id: 'dusk', label: 'Dusk', top: '#5b6bb0', bottom: '#d6c3ec' },
  { id: 'meadow', label: 'Meadow', top: '#8fd0a0', bottom: '#eaf5da' },
  { id: 'night', label: 'Night', top: '#0e1230', bottom: '#33406b' },
];

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
  /** First-class portals to other worlds. */
  portals?: Portal[];
  /** Free-standing decor (ambiance not tied to any locus). */
  decor?: Decor[];
  /** Optional so older palace files still load; defaults applied on read. */
  environment?: Environment;
  /** Which image pipeline this world uses (credentials are app-global). */
  generation?: WorldGeneration;
}

/** A soft daylight blue — cheerful and lets geometry read well. */
export const DEFAULT_BACKGROUND = '#9fb8d6';

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
