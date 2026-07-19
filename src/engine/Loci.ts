import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Locus, Palace, Vec3 } from '../model/palace';

const meshLoader = new GLTFLoader();

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
  /** Generated 3D mesh placed at the locus; supersedes the flat image. */
  mesh3d?: THREE.Object3D;
  mesh3dSrc?: string;
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
  private readonly resolve: ResolveAsset;
  private readonly labelTextures = new Map<number, THREE.Texture>();

  private selectedId: string | null = null;
  private targetedId: string | null = null;

  // Scratch to avoid per-frame allocation.
  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly inv = new THREE.Matrix4();

  constructor(scene: THREE.Scene, resolve: ResolveAsset) {
    this.group.name = 'loci';
    scene.add(this.group);
    this.resolve = resolve;
  }

  /** Reconcile the rendered markers with the palace's loci. */
  sync(palace: Palace): void {
    const live = new Set<string>();
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
      this.updateImage(marker, locus.image_2d);
      void this.updateMesh3d(marker, locus.mesh_3d);
    }
    // Drop markers whose loci are gone.
    for (const [id, marker] of this.markers) {
      if (!live.has(id)) {
        this.group.remove(marker.group);
        this.markers.delete(id);
      }
    }
    this.refreshStates();
  }

  private placeMarker(marker: Marker, locus: Locus, root: THREE.Object3D): void {
    // local -> world position, and local -> world surface normal (direction only).
    this.v.set(locus.local_position[0], locus.local_position[1], locus.local_position[2]);
    this.v.applyMatrix4(root.matrixWorld);
    this.n.set(locus.local_normal[0], locus.local_normal[1], locus.local_normal[2]);
    this.n.transformDirection(root.matrixWorld).normalize();
    // Nudge the marker just off the surface so it doesn't z-fight the wall/floor.
    marker.group.position.copy(this.v).addScaledVector(this.n, 0.06);
  }

  /** Show (or hide) the generated 2D image as a billboard above the marker. */
  private updateImage(marker: Marker, src: string | null): void {
    if (src && marker.imageSrc !== src) {
      marker.imageSrc = src;
      const tex = new THREE.TextureLoader().load(src);
      tex.colorSpace = THREE.SRGBColorSpace;
      if (!marker.image) {
        marker.image = new THREE.Sprite(
          // depthTest off + a high renderOrder: draw the image as an always-visible
          // label so a nearby wall/floor can't clip the camera-facing quad.
          new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
        );
        marker.image.scale.setScalar(0.9);
        marker.image.position.y = 1.0;
        marker.image.renderOrder = 10;
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
            m.emissiveIntensity = 0.45;
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
    const scale = 0.8 / (Math.max(size.x, size.y, size.z) || 1);
    obj.scale.setScalar(scale);
    obj.position.set(-center.x * scale, 0.6 - center.y * scale, -center.z * scale);

    marker.group.add(obj);
    marker.mesh3d = obj;
    if (marker.image) marker.image.visible = false; // the 3D object supersedes the flat image
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
      const color = COLORS[state];
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
      new THREE.SpriteMaterial({ map: this.numberTexture(0), transparent: true, depthWrite: false, depthTest: false, toneMapped: false }),
    );
    label.scale.setScalar(0.4);
    label.position.y = 0.28;

    group.add(halo, core, label);
    this.group.add(group);

    const marker: Marker = { group, core, halo, label, order: 0 };
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
