import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Locus, Palace, Portal, SceneProp, Vec3 } from '../model/palace';

const meshLoader = new GLTFLoader();
const PORTAL_AXIS = new THREE.Vector3(0, 0, 1); // torus's local axis, aligned to the surface normal
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** One rendered scene prop (a text/image billboard sprite, or a 3D mesh group). */
interface PropObj {
  kind: SceneProp['kind'];
  object: THREE.Object3D; // Sprite (text/image) or Group (mesh)
  src?: string;
  text?: string;
  aspect?: number; // width/height of a text plaque, for non-square scaling
  meshRawCenter?: THREE.Vector3;
  meshMaxDim?: number;
}

/** Look up the live scene object for an asset id (its current world transform). */
export type ResolveAsset = (assetId: string) => THREE.Object3D | null;

/** Visual state of a marker, drives its colour/scale. */
type MarkerState = 'normal' | 'targeted' | 'selected';

const COLORS: Record<MarkerState, number> = {
  normal: 0xffcf5c, // warm gold
  targeted: 0xffffff, // looking right at it
  selected: 0x6cf0ff, // chosen in the panel / being edited
};

interface Marker {
  group: THREE.Group;
  core: THREE.Mesh;
  halo: THREE.Sprite;
  label: THREE.Sprite;
  order: number;
  /** Billboard of the generated 2D image, shown above the marker when present. */
  image?: THREE.Sprite;
  imageSrc?: string;
  /** The mnemonic text as a floating plaque (see Environment.captions). */
  caption?: THREE.Sprite;
  captionText?: string;
  captionAspect?: number;
  /** Generated 3D mesh placed at the locus; supersedes the flat image. */
  mesh3d?: THREE.Object3D;
  mesh3dSrc?: string;
  /** World surface normal at this locus, so the image/mesh sit in front of the wall. */
  normal: THREE.Vector3;
  /** Whether this locus holds a nested child palace (drives the doorway colour). */
  hasChild?: boolean;
  /** A ring shown around doorway loci so they read as an enterable portal. */
  portal?: THREE.Mesh;
  /** Per-object transform (applies to the image/mesh only, not the orb). */
  objectScale: number;
  /** Per-object nudge [right, up, out] in metres (see Locus.object_offset). */
  objectOffset: THREE.Vector3;
  objectRot: THREE.Vector3; // degrees
  /** Loaded mesh's box centre + max dimension, for scaling/positioning. */
  meshRawCenter?: THREE.Vector3;
  meshMaxDim?: number;
  /** Extra scene props composed around this locus, keyed by prop id. */
  props: Map<string, PropObj>;
}

/**
 * Renders one glowing numbered marker per locus and owns all world<->local
 * coordinate math. Loci are stored asset-local; markers are placed by pushing
 * those local coords through the asset's CURRENT world matrix, so if the asset
 * moves or is swapped, every marker follows automatically.
 */
export class LociLayer {
  private readonly group = new THREE.Group();
  private readonly markers = new Map<string, Marker>();
  private readonly portalMarkers = new Map<string, { group: THREE.Group; ring: THREE.Mesh; hit: THREE.Mesh; po?: PropObj }>();
  private readonly decorMarkers = new Map<string, { group: THREE.Group; po: PropObj; normal: THREE.Vector3; hit: THREE.Mesh }>();
  private readonly resolve: ResolveAsset;
  private readonly labelTextures = new Map<number, THREE.Texture>();

  private selectedId: string | null = null;
  private targetedId: string | null = null;
  /** When true, markers draw through walls (see every pin regardless of room). */
  private xray = false;
  // Debug-tunable look.
  private markerScale = 1;
  private meshEmissive = 0.45;

  // Scratch to avoid per-frame allocation.
  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly inv = new THREE.Matrix4();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpNudge = new THREE.Vector3();

  constructor(scene: THREE.Scene, resolve: ResolveAsset) {
    this.group.name = 'loci';
    scene.add(this.group);
    this.resolve = resolve;
  }

  /** Reconcile the rendered markers with the palace's loci. */
  sync(palace: Palace): void {
    const live = new Set<string>();
    const captions = palace.environment?.captions !== false; // default on
    const cues = palace.environment?.cueLabels !== false; // default on
    for (const locus of palace.loci) {
      live.add(locus.id);
      const root = this.resolve(locus.asset_id);
      if (!root) continue;
      root.updateWorldMatrix(true, false);

      const marker = this.markers.get(locus.id) ?? this.createMarker(locus.id);
      this.placeMarker(marker, locus, root);
      if (marker.order !== locus.order) {
        marker.order = locus.order;
        marker.label.material.map = this.numberTexture(locus.order);
        marker.label.material.needsUpdate = true;
      }
      marker.hasChild = locus.child_palace != null;
      // The orb/number scale with the global marker size only; the attached object
      // scales/rotates independently (see positionChildren).
      marker.group.scale.setScalar(this.markerScale);
      marker.objectScale = locus.object_scale ?? 1;
      const off = locus.object_offset ?? [0, 0, 0];
      marker.objectOffset.set(off[0], off[1], off[2]);
      const r = locus.object_rotation ?? [0, 0, 0];
      marker.objectRot.set(r[0], r[1], r[2]);
      this.updatePortal(marker);
      this.updateImage(marker, locus.image_2d);
      this.updateCaption(marker, captions ? locus.image_prompt : '', cues ? locus.label : '');
      void this.updateMesh3d(marker, locus.mesh_3d);
      this.positionChildren(marker);
      this.syncProps(marker, locus);
      this.applyXray(marker);
    }
    // Drop markers whose loci are gone.
    for (const [id, marker] of this.markers) {
      if (!live.has(id)) {
        for (const po of marker.props.values()) disposePropObject(po);
        this.group.remove(marker.group);
        this.markers.delete(id);
      }
    }
    this.refreshStates();
    this.syncPortals(palace);
    this.syncDecor(palace);
  }

  /** Render free-standing decor: a prop anchored in asset-local space, no locus. */
  private syncDecor(palace: Palace): void {
    const live = new Set<string>();
    for (const d of palace.decor ?? []) {
      live.add(d.id);
      const root = this.resolve(d.asset_id);
      if (!root) continue;
      root.updateWorldMatrix(true, false);

      let dm = this.decorMarkers.get(d.id);
      if (!dm || dm.po.kind !== d.kind) {
        if (dm) {
          this.group.remove(dm.group);
          disposePropObject(dm.po);
        }
        const group = new THREE.Group();
        const po = buildProp(d.kind);
        // Invisible sphere so the crosshair can target decor (for G-move / tooltips).
        const hit = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hit.userData.decorId = d.id;
        group.add(po.object, hit);
        this.group.add(group);
        dm = { group, po, normal: new THREE.Vector3(), hit };
        this.decorMarkers.set(d.id, dm);
      }

      this.v.set(d.local_position[0], d.local_position[1], d.local_position[2]).applyMatrix4(root.matrixWorld);
      this.n.set(d.local_normal[0], d.local_normal[1], d.local_normal[2]).transformDirection(root.matrixWorld).normalize();
      dm.group.position.copy(this.v);
      dm.normal.copy(this.n);

      // Reuse the prop content/scale machinery via a zero-offset pseudo-prop.
      const pseudo: SceneProp = { id: d.id, kind: d.kind, text: d.text, image_prompt: d.image_prompt, src: d.src, scale: d.scale, rotation: d.rotation };
      if (d.kind === 'text') this.updatePropText(dm.po, d.text ?? '');
      else if (d.kind === 'image') this.updatePropImage(dm.po, d.src ?? null);
      else void this.updatePropMesh(dm.po, pseudo);
      this.scaleProp(dm.po, pseudo);

      // Sit it just off the surface (meshes push out by ~half their footprint).
      const s = d.scale ?? 1;
      const push = d.kind === 'mesh' ? 0.4 * s + 0.15 : 0.4;
      dm.po.object.position.copy(this.n).multiplyScalar(push);
      // Keep the pick sphere over the visual, sized to it.
      dm.hit.position.copy(dm.po.object.position);
      dm.hit.scale.setScalar(Math.max(0.5, 0.7 * s));
    }
    for (const [id, dm] of this.decorMarkers) {
      if (!live.has(id)) {
        this.group.remove(dm.group);
        disposePropObject(dm.po);
        this.decorMarkers.delete(id);
      }
    }
  }

  /** Render a pulsing ring for each first-class portal (position/orient like loci). */
  private syncPortals(palace: Palace): void {
    const live = new Set<string>();
    for (const portal of palace.portals ?? []) {
      live.add(portal.id);
      const root = this.resolve(portal.asset_id);
      if (!root) continue;
      root.updateWorldMatrix(true, false);
      const pm = this.portalMarkers.get(portal.id) ?? this.createPortal(portal.id);
      this.v.set(portal.local_position[0], portal.local_position[1], portal.local_position[2]).applyMatrix4(root.matrixWorld);
      this.n.set(portal.local_normal[0], portal.local_normal[1], portal.local_normal[2]).transformDirection(root.matrixWorld).normalize();
      // Float the ring off the surface (into the room) so it doesn't straddle the wall.
      pm.group.position.copy(this.v).addScaledVector(this.n, 0.4);
      pm.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.n);

      // Optional visual (image/mesh) shown at the doorway alongside the ring.
      if (portal.kind && portal.src) {
        if (!pm.po || pm.po.kind !== portal.kind) {
          if (pm.po) {
            pm.group.remove(pm.po.object);
            disposePropObject(pm.po);
          }
          pm.po = buildProp(portal.kind);
          pm.group.add(pm.po.object);
        }
        const pseudo: SceneProp = { id: portal.id, kind: portal.kind, src: portal.src, image_prompt: portal.image_prompt, scale: portal.scale, rotation: portal.rotation };
        if (portal.kind === 'image') this.updatePropImage(pm.po, portal.src ?? null);
        else void this.updatePropMesh(pm.po, pseudo);
        this.scaleProp(pm.po, pseudo);
        const s = portal.scale ?? 1;
        const push = portal.kind === 'mesh' ? 0.4 * s + 0.15 : 0.5;
        pm.po.object.position.copy(this.n).multiplyScalar(push);
      } else if (pm.po) {
        pm.group.remove(pm.po.object);
        disposePropObject(pm.po);
        pm.po = undefined;
      }
    }
    for (const [id, pm] of this.portalMarkers) {
      if (!live.has(id)) {
        if (pm.po) disposePropObject(pm.po);
        this.group.remove(pm.group);
        this.portalMarkers.delete(id);
      }
    }
  }

  private createPortal(id: string): { group: THREE.Group; ring: THREE.Mesh; hit: THREE.Mesh; po?: PropObj } {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.05, 16, 48),
      new THREE.MeshBasicMaterial({ color: 0xb98cff, toneMapped: false, transparent: true, opacity: 0.92 }),
    );
    // Invisible sphere for reliable crosshair picking through the ring's hole.
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.portalId = id;
    group.add(ring, hit);
    this.group.add(group);
    const pm: { group: THREE.Group; ring: THREE.Mesh; hit: THREE.Mesh; po?: PropObj } = { group, ring, hit };
    this.portalMarkers.set(id, pm);
    return pm;
  }

  /** The portal id under a ray (crosshair), or null. */
  pickPortal(raycaster: THREE.Raycaster): string | null {
    const hits: THREE.Object3D[] = [];
    for (const pm of this.portalMarkers.values()) hits.push(pm.hit);
    const found = raycaster.intersectObjects(hits, false);
    return found.length > 0 ? (found[0].object.userData.portalId as string) : null;
  }

  /** The decor id under a ray (crosshair), or null. */
  pickDecor(raycaster: THREE.Raycaster): string | null {
    const hits: THREE.Object3D[] = [];
    for (const dm of this.decorMarkers.values()) hits.push(dm.hit);
    const found = raycaster.intersectObjects(hits, false);
    return found.length > 0 ? (found[0].object.userData.decorId as string) : null;
  }

  worldPositionOfPortal(portal: Portal, out: THREE.Vector3): THREE.Vector3 {
    const root = this.resolve(portal.asset_id);
    if (!root) return out.set(0, 0, 0);
    root.updateWorldMatrix(true, false);
    return out.set(portal.local_position[0], portal.local_position[1], portal.local_position[2]).applyMatrix4(root.matrixWorld);
  }

  private placeMarker(marker: Marker, locus: Locus, root: THREE.Object3D): void {
    // local -> world position, and local -> world surface normal (direction only).
    this.v.set(locus.local_position[0], locus.local_position[1], locus.local_position[2]);
    this.v.applyMatrix4(root.matrixWorld);
    this.n.set(locus.local_normal[0], locus.local_normal[1], locus.local_normal[2]);
    this.n.transformDirection(root.matrixWorld).normalize();
    // Nudge the marker just off the surface so it doesn't z-fight the wall/floor.
    marker.group.position.copy(this.v).addScaledVector(this.n, 0.06);
    marker.normal.copy(this.n);
  }

  /**
   * Place the image and mesh in FRONT of the surface (along the normal) so a
   * wall-mounted locus's content sits inside the room, not straddling the wall.
   * The group has no rotation, so local axes equal world axes here.
   */
  private positionChildren(marker: Marker): void {
    const os = marker.objectScale;
    if (marker.portal) marker.portal.quaternion.setFromUnitVectors(PORTAL_AXIS, marker.normal);

    // The user's nudge, expressed in the locus's own frame: right / up / out.
    const right = this.tmpRight;
    const up = this.tmpUp;
    this.basisFromNormal(marker.normal, right, up);
    const nudge = this.tmpNudge
      .set(0, 0, 0)
      .addScaledVector(right, marker.objectOffset.x)
      .addScaledVector(up, marker.objectOffset.y)
      .addScaledVector(marker.normal, marker.objectOffset.z);

    if (marker.image) {
      marker.image.scale.setScalar(0.9 * os);
      marker.image.position.copy(marker.normal).multiplyScalar(0.5 * os);
      marker.image.position.y += 0.8 * os;
      marker.image.position.add(nudge);
    }
    if (marker.caption) {
      // Sit above the image when one is showing, otherwise take its place.
      const a = marker.captionAspect ?? 3;
      const h = 0.34;
      marker.caption.scale.set(h * a, h, 1);
      marker.caption.position.copy(marker.normal).multiplyScalar(0.5 * os);
      const imageShown = !!marker.image && marker.image.visible;
      marker.caption.position.y += imageShown ? 0.8 * os + 0.45 * os + h * 0.5 + 0.05 : 0.75;
      if (imageShown) marker.caption.position.add(nudge); // follow the image it labels
    }
    if (marker.mesh3d && marker.meshRawCenter && marker.meshMaxDim) {
      // Fit into ~0.8u, times the per-locus object scale.
      const scale = (0.8 / marker.meshMaxDim) * os;
      marker.mesh3d.scale.setScalar(scale);
      marker.mesh3d.rotation.set(deg2rad(marker.objectRot.x), deg2rad(marker.objectRot.y), deg2rad(marker.objectRot.z));
      const half = (marker.meshMaxDim * scale) / 2;
      // recentre, then push out past the wall by its half-size and lift slightly.
      marker.mesh3d.position.copy(marker.meshRawCenter).multiplyScalar(-scale).addScaledVector(marker.normal, half + 0.15);
      marker.mesh3d.position.y += 0.3 * os;
      marker.mesh3d.position.add(nudge);
    }
  }

  /**
   * Reconcile a locus's scene props with their rendered objects. Each prop sits at
   * an offset in the locus's local frame — [right, worldUp, out(normal)] — so
   * left/right slides along the wall, up/down is vertical, in/out is depth.
   */
  /** Orthonormal tangent basis at a surface: right (horizontal), up, out(=normal). */
  private basisFromNormal(n: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3): void {
    right.copy(WORLD_UP).cross(n);
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(n, right).normalize();
  }

  private syncProps(marker: Marker, locus: Locus): void {
    const live = new Set<string>();
    const out = marker.normal;
    const right = this.tmpRight;
    const up = this.tmpUp;
    this.basisFromNormal(out, right, up);

    for (const p of locus.props ?? []) {
      live.add(p.id);
      let po = marker.props.get(p.id);
      if (!po || po.kind !== p.kind) {
        if (po) {
          marker.group.remove(po.object);
          disposePropObject(po);
        }
        po = buildProp(p.kind);
        marker.props.set(p.id, po);
        marker.group.add(po.object);
      }
      if (p.kind === 'text') this.updatePropText(po, p.text ?? '');
      else if (p.kind === 'image') this.updatePropImage(po, p.src ?? null);
      else void this.updatePropMesh(po, p);

      const o = p.offset ?? [0, 0, 0];
      po.object.position.copy(right).multiplyScalar(o[0]).addScaledVector(up, o[1]).addScaledVector(out, o[2]);
      this.scaleProp(po, p);
    }
    for (const [id, po] of marker.props) {
      if (!live.has(id)) {
        marker.group.remove(po.object);
        disposePropObject(po);
        marker.props.delete(id);
      }
    }
  }

  private scaleProp(po: PropObj, p: SceneProp): void {
    const s = p.scale ?? 1;
    if (po.kind === 'image') {
      (po.object as THREE.Sprite).scale.setScalar(0.9 * s);
    } else if (po.kind === 'text') {
      const a = po.aspect ?? 3;
      (po.object as THREE.Sprite).scale.set(0.42 * a * s, 0.42 * s, 1);
    } else if (po.kind === 'mesh') {
      if (po.meshMaxDim) po.object.scale.setScalar((0.8 / po.meshMaxDim) * s);
      const r = p.rotation ?? [0, 0, 0];
      po.object.rotation.set(deg2rad(r[0]), deg2rad(r[1]), deg2rad(r[2]));
    }
  }

  private updatePropText(po: PropObj, text: string): void {
    if (po.text === text) return;
    po.text = text;
    const spr = po.object as THREE.Sprite;
    const mat = spr.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    const { tex, aspect } = textTexture(text || '…');
    mat.map = tex;
    mat.needsUpdate = true;
    po.aspect = aspect;
  }

  private updatePropImage(po: PropObj, src: string | null): void {
    const spr = po.object as THREE.Sprite;
    if (src) {
      if (po.src !== src) {
        po.src = src;
        const tex = new THREE.TextureLoader().load(src);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = spr.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.map = tex;
        mat.needsUpdate = true;
      }
      spr.visible = true;
    } else {
      spr.visible = false;
      po.src = undefined;
    }
  }

  private async updatePropMesh(po: PropObj, p: SceneProp): Promise<void> {
    const src = p.src ?? null;
    if ((src ?? undefined) === po.src) return;
    po.src = src ?? undefined;
    for (const c of [...po.object.children]) {
      po.object.remove(c);
      disposeSubtree(c);
    }
    po.meshRawCenter = undefined;
    po.meshMaxDim = undefined;
    if (!src) return;

    const gltf = await meshLoader.loadAsync(src);
    if (po.src !== src) {
      disposeSubtree(gltf.scene); // superseded
      return;
    }
    const obj = gltf.scene;
    applyEmissive(obj, this.meshEmissive);
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    po.meshRawCenter = center.clone();
    po.meshMaxDim = Math.max(size.x, size.y, size.z) || 1;
    // Recentre the inner object at the group origin so the group scales about its
    // centre (the group's own position is the prop offset, unaffected by scale).
    obj.position.copy(center).multiplyScalar(-1);
    po.object.add(obj);
    // Apply scale/rotation now that the mesh's size is known (the load is async, so
    // syncProps already ran with meshMaxDim unset).
    this.scaleProp(po, p);
  }

  /** Show (or hide) the generated 2D image as a billboard above the marker. */
  private updateImage(marker: Marker, src: string | null): void {
    if (src && marker.imageSrc !== src) {
      marker.imageSrc = src;
      const tex = new THREE.TextureLoader().load(src);
      tex.colorSpace = THREE.SRGBColorSpace;
      if (!marker.image) {
        marker.image = new THREE.Sprite(
          // Depth-tested on purpose: the image belongs to the room, so a wall in
          // front of it should hide it. When one ends up buried in the surface it's
          // pinned to, the fix is the per-locus "Push out" nudge (object_offset) —
          // or X for x-ray, which turns depth testing off everywhere.
          new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
        );
        marker.image.scale.setScalar(0.9);
        marker.image.renderOrder = 10; // position is set by positionChildren
        marker.group.add(marker.image);
      } else {
        const mat = marker.image.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.map = tex;
        mat.needsUpdate = true;
      }
      marker.image.visible = true;
    } else if (!src && marker.image) {
      marker.image.visible = false;
      marker.imageSrc = undefined;
    }
  }

  /** Show (or hide) the mnemonic text as a plaque above the marker. */
  private updateCaption(marker: Marker, text: string, title = ''): void {
    const t = text.trim();
    const heading = title.trim();
    if (!t && !heading) {
      if (marker.caption) marker.caption.visible = false;
      return;
    }
    if (!marker.caption) {
      marker.caption = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
      marker.caption.renderOrder = 10; // readable over nearby walls, like the image
      marker.group.add(marker.caption);
    }
    const key = `${heading}\u0000${t}`;
    if (marker.captionText !== key) {
      marker.captionText = key;
      const mat = marker.caption.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      const { tex, aspect } = textTexture(t, heading);
      mat.map = tex;
      mat.needsUpdate = true;
      marker.captionAspect = aspect;
    }
    marker.caption.visible = true;
  }

  /** Load and place the generated GLB at the locus, scaled to a sensible size. */
  private async updateMesh3d(marker: Marker, src: string | null): Promise<void> {
    if ((src ?? undefined) === marker.mesh3dSrc) return;
    marker.mesh3dSrc = src ?? undefined;

    if (marker.mesh3d) {
      marker.group.remove(marker.mesh3d);
      disposeSubtree(marker.mesh3d);
      marker.mesh3d = undefined;
    }
    if (!src) {
      if (marker.image) marker.image.visible = true; // flat image returns
      return;
    }

    const gltf = await meshLoader.loadAsync(src);
    if (marker.mesh3dSrc !== src) {
      disposeSubtree(gltf.scene); // a newer change superseded this load
      return;
    }
    const obj = gltf.scene;
    // Generated meshes (esp. from image-to-3D) look dull/dark under interior light.
    // Make them partly self-lit from their own texture so they keep the vibrancy of
    // the 2D image the user approved, without going fully unlit (which reads flat).
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const mat = o.material;
        const mats = Array.isArray(mat) ? mat : [mat];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial) {
            if (m.map) m.emissiveMap = m.map;
            m.emissive = new THREE.Color(0xffffff);
            m.emissiveIntensity = this.meshEmissive;
            m.needsUpdate = true;
          }
        }
      }
    });
    // Normalise: fit the mesh into ~0.8 units and sit it just above the marker.
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    // Store raw box centre + size; positionChildren computes scale/position/rotation
    // so a live object-scale/rotation change needs no reload.
    marker.meshRawCenter = center.clone();
    marker.meshMaxDim = Math.max(size.x, size.y, size.z) || 1;

    marker.group.add(obj);
    marker.mesh3d = obj;
    this.positionChildren(marker);
    if (marker.image) marker.image.visible = false; // the 3D object supersedes the flat image
  }

  private portalPhase = 0;

  /** Gently pulse portal rings each frame so doorways feel alive. */
  update(): void {
    this.portalPhase += 0.05;
    const s = 1 + 0.06 * Math.sin(this.portalPhase);
    for (const marker of this.markers.values()) {
      if (marker.portal) marker.portal.scale.setScalar(s);
    }
    for (const pm of this.portalMarkers.values()) pm.ring.scale.setScalar(s);
  }

  private updatePortal(marker: Marker): void {
    if (marker.hasChild && !marker.portal) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.24, 0.03, 12, 40),
        new THREE.MeshBasicMaterial({ color: 0xb98cff, toneMapped: false, transparent: true, opacity: 0.9 }),
      );
      marker.group.add(ring);
      marker.portal = ring;
    } else if (!marker.hasChild && marker.portal) {
      marker.group.remove(marker.portal);
      marker.portal.geometry.dispose();
      (marker.portal.material as THREE.Material).dispose();
      marker.portal = undefined;
    }
  }

  get xrayOn(): boolean {
    return this.xray;
  }

  /** Debug: global marker scale (combined with each locus's object_scale on sync). */
  setMarkerScale(scale: number): void {
    this.markerScale = scale;
  }

  /** Debug: how self-lit generated meshes are (0 = lit only by scene, 1 = glowing). */
  setMeshEmissive(value: number): void {
    this.meshEmissive = value;
    for (const marker of this.markers.values()) {
      marker.mesh3d?.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m instanceof THREE.MeshStandardMaterial) m.emissiveIntensity = value;
          }
        }
      });
    }
  }

  /** Toggle whether markers are occluded by walls (off) or drawn through them (on). */
  setXray(on: boolean): void {
    this.xray = on;
    for (const marker of this.markers.values()) this.applyXray(marker);
  }

  /**
   * Default: markers depth-test against the world, so you only see pins in your
   * current room. X-ray: draw them on top of everything to locate every pin. The
   * generated 3D mesh always stays depth-tested (it's a real object in the space).
   */
  private applyXray(marker: Marker): void {
    const sprites = [marker.core, marker.halo, marker.label, marker.image, marker.caption];
    const order = this.xray ? 10 : 0;
    for (const s of sprites) {
      if (!s) continue;
      (s.material as THREE.Material).depthTest = !this.xray;
      s.renderOrder = order;
    }
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.refreshStates();
  }

  setTargeted(id: string | null): void {
    if (id === this.targetedId) return;
    this.targetedId = id;
    this.refreshStates();
  }

  private refreshStates(): void {
    for (const [id, marker] of this.markers) {
      const state: MarkerState =
        id === this.selectedId ? 'selected' : id === this.targetedId ? 'targeted' : 'normal';
      // A locus with a nested child gets a distinct "doorway" colour when idle.
      const color = state === 'normal' && marker.hasChild ? 0xb98cff : COLORS[state];
      (marker.core.material as THREE.MeshBasicMaterial).color.setHex(color);
      (marker.halo.material as THREE.SpriteMaterial).color.setHex(color);
      const scale = state === 'normal' ? 1 : 1.35;
      marker.core.scale.setScalar(scale);
    }
  }

  /** The locus id under a ray (e.g. the crosshair), or null. */
  pick(raycaster: THREE.Raycaster): string | null {
    const cores: THREE.Object3D[] = [];
    for (const m of this.markers.values()) cores.push(m.core);
    const hits = raycaster.intersectObjects(cores, false);
    return hits.length > 0 ? (hits[0].object.userData.locusId as string) : null;
  }

  /** World-space position of a locus (for teleporting the camera in review). */
  worldPosition(locus: Locus, out: THREE.Vector3): THREE.Vector3 {
    const root = this.resolve(locus.asset_id);
    if (!root) return out.set(0, 0, 0);
    root.updateWorldMatrix(true, false);
    out.set(locus.local_position[0], locus.local_position[1], locus.local_position[2]);
    return out.applyMatrix4(root.matrixWorld);
  }

  /**
   * Convert a world-space point into a prop offset [right, up, out] in a locus's
   * local tangent frame — the inverse of how syncProps places props. Used to place
   * or move a prop by aiming at a surface. Returns null if the marker isn't built.
   */
  offsetFromWorld(locusId: string, worldPoint: THREE.Vector3): Vec3 | null {
    const marker = this.markers.get(locusId);
    if (!marker) return null;
    this.basisFromNormal(marker.normal, this.tmpRight, this.tmpUp);
    // Props are children of marker.group, so measure from the group's world origin.
    const delta = this.v.copy(worldPoint).sub(marker.group.position);
    return [delta.dot(this.tmpRight), delta.dot(this.tmpUp), delta.dot(marker.normal)];
  }

  /** World-space surface normal of a locus. */
  worldNormal(locus: Locus, out: THREE.Vector3): THREE.Vector3 {
    const root = this.resolve(locus.asset_id);
    if (!root) return out.set(0, 1, 0);
    out.set(locus.local_normal[0], locus.local_normal[1], locus.local_normal[2]);
    return out.transformDirection(root.matrixWorld).normalize();
  }

  /**
   * Convert a world-space surface hit (from placing/moving a locus) into the
   * asset-local coordinates we persist. This is the inverse of placeMarker.
   */
  worldToLocal(assetId: string, worldPoint: THREE.Vector3, worldNormal: THREE.Vector3): { position: Vec3; normal: Vec3 } {
    const root = this.resolve(assetId);
    if (!root) {
      return { position: [worldPoint.x, worldPoint.y, worldPoint.z], normal: [worldNormal.x, worldNormal.y, worldNormal.z] };
    }
    root.updateWorldMatrix(true, false);
    this.inv.copy(root.matrixWorld).invert();
    this.v.copy(worldPoint).applyMatrix4(this.inv);
    this.n.copy(worldNormal).transformDirection(this.inv).normalize();
    return { position: [this.v.x, this.v.y, this.v.z], normal: [this.n.x, this.n.y, this.n.z] };
  }

  private createMarker(locusId: string): Marker {
    const group = new THREE.Group();

    // Bright unlit core sphere — always visible regardless of scene lighting.
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 20, 16),
      new THREE.MeshBasicMaterial({ color: COLORS.normal, toneMapped: false }),
    );
    core.userData.locusId = locusId;

    // Soft additive halo so markers read as "glowing" and are findable across a room.
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: haloTexture(),
        color: COLORS.normal,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.scale.setScalar(0.7);

    // Floating number so the route order is legible in-world.
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.numberTexture(0), transparent: true, depthWrite: false, toneMapped: false }),
    );
    label.scale.setScalar(0.4);
    label.position.y = 0.28;

    group.add(halo, core, label);
    this.group.add(group);

    const marker: Marker = {
      group,
      core,
      halo,
      label,
      order: 0,
      normal: new THREE.Vector3(0, 1, 0),
      objectScale: 1,
      objectOffset: new THREE.Vector3(),
      objectRot: new THREE.Vector3(0, 0, 0),
      props: new Map(),
    };
    this.markers.set(locusId, marker);
    return marker;
  }

  /** A cached canvas texture of a route number inside a disc. */
  private numberTexture(order: number): THREE.Texture {
    const cached = this.labelTextures.get(order);
    if (cached) return cached;

    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(10,10,12,0.85)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffcf5c';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(order), size / 2, size / 2 + 4);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.labelTextures.set(order, tex);
    return tex;
  }
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Create the empty render object for a prop (a billboard sprite, or a mesh group). */
function buildProp(kind: SceneProp['kind']): PropObj {
  if (kind === 'mesh') return { kind, object: new THREE.Group() };
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
  sprite.renderOrder = 10; // draw over walls like the hero image
  return { kind, object: sprite };
}

/** A rounded translucent plaque with the caption text; returns its aspect ratio too. */
/**
 * Render text into a rounded dark plaque. Long text word-wraps at ~MAX_LINE px and
 * is capped at MAX_LINES (ellipsis) so a paragraph-length mnemonic stays legible
 * in the world instead of becoming a 20-metre-wide strip.
 */
function textTexture(text: string, title = ''): { tex: THREE.Texture; aspect: number } {
  const fontSize = 64;
  const pad = 26;
  const lineH = Math.round(fontSize * 1.18);
  const MAX_LINE = 900;
  const MAX_LINES = 4;
  const meas = document.createElement('canvas').getContext('2d')!;
  const font = `bold ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  meas.font = font;

  // Greedy word wrap; hard-break any single word wider than a line.
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${word}` : word;
      if (meas.measureText(trial).width <= MAX_LINE) {
        line = trial;
      } else {
        if (line) lines.push(line);
        line = word;
        while (meas.measureText(line).width > MAX_LINE && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && meas.measureText(line.slice(0, cut)).width > MAX_LINE) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > MAX_LINES) {
    lines.length = MAX_LINES;
    lines[MAX_LINES - 1] = `${lines[MAX_LINES - 1].replace(/\s*\S*$/, '')}…`;
  }

  // The location cue rides above the mnemonic as a smaller, dimmer heading.
  const titleSize = Math.round(fontSize * 0.62);
  const titleFont = `600 ${titleSize}px ui-sans-serif, system-ui, sans-serif`;
  const titleH = title ? Math.round(titleSize * 1.5) : 0;
  let titleText = title;
  if (title) {
    meas.font = titleFont;
    while (titleText.length > 4 && meas.measureText(titleText).width > MAX_LINE) {
      titleText = `${titleText.slice(0, -2)}…`;
    }
    meas.font = font;
  }

  const bodyW = lines.length ? Math.max(...lines.map((l) => meas.measureText(l).width)) : 0;
  meas.font = titleFont;
  const titleW = titleText ? meas.measureText(titleText).width : 0;
  meas.font = font;
  const textW = Math.max(bodyW, titleW);
  const w = Math.min(MAX_LINE + pad * 2, Math.max(80, Math.ceil(textW) + pad * 2));
  const h = lineH * lines.length + titleH + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(12,12,16,0.72)';
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(1, 1, w - 2, h - 2, 18);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, w, h);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (titleText) {
    ctx.fillStyle = '#ffcf5c'; // the same warm gold as the markers
    ctx.font = titleFont;
    ctx.fillText(titleText, w / 2, pad + titleH / 2);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = font;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, pad + titleH + lineH * (i + 0.5) + 2));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / h };
}

/** Make a loaded mesh partly self-lit from its own texture (see updateMesh3d). */
function applyEmissive(root: THREE.Object3D, intensity: number): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m instanceof THREE.MeshStandardMaterial) {
          if (m.map) m.emissiveMap = m.map;
          m.emissive = new THREE.Color(0xffffff);
          m.emissiveIntensity = intensity;
          m.needsUpdate = true;
        }
      }
    }
  });
}

/** Free a prop's GPU resources (its sprite texture/material, or its mesh subtree). */
function disposePropObject(po: PropObj): void {
  if (po.object instanceof THREE.Sprite) {
    const mat = po.object.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.dispose();
  } else {
    disposeSubtree(po.object);
  }
}

/** Free GPU memory for a loaded mesh subtree before we drop it. */
function disposeSubtree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }
  });
}

// A radial-gradient sprite used for every marker's glow (built once, shared).
let sharedHalo: THREE.Texture | null = null;
function haloTexture(): THREE.Texture {
  if (sharedHalo) return sharedHalo;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  sharedHalo = new THREE.CanvasTexture(canvas);
  return sharedHalo;
}
