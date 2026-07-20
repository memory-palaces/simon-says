import * as THREE from 'three';
import { FirstPersonControls } from './FirstPersonControls';
import { loadGlbFromUrl, loadGlbFromFile, type LoadedModel } from './loadGlb';
import { BACKGROUND_PATTERNS, DEFAULT_ASSET_ID, DEFAULT_BACKGROUND, type Environment } from '../model/palace';

/** A surface hit under the crosshair, in world space. */
export interface SurfaceHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

/**
 * Owns the renderer, scene, camera and the render loop. Everything spatial lives
 * here: geometry, first-person movement, and the raycasts the editor needs.
 */
export class Viewer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly fp: FirstPersonControls;

  private currentModel: THREE.Group | null = null;
  private currentAssetFile = '';
  private readonly clock = new THREE.Clock();
  private raf = 0;
  private readonly frameCallbacks: Array<(dt: number) => void> = [];

  // Reusable scratch for the crosshair raycast.
  private readonly pickRay = new THREE.Raycaster();
  private readonly camDir = new THREE.Vector3();
  private readonly normalMat = new THREE.Matrix3();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    const bg = new THREE.Color(DEFAULT_BACKGROUND);
    this.scene.background = bg.clone();
    this.scene.fog = new THREE.Fog(bg.clone(), 60, 200);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 4000);
    this.camera.position.set(0, 1.7, 0);

    this.addLights();
    this.fp = new FirstPersonControls(this.camera, this.renderer.domElement);
    this.scene.add(this.fp.controls.object);

    window.addEventListener('resize', this.onResize);
  }

  // Lights, kept so a per-world brightness multiplier can scale them.
  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private headlamp!: THREE.PointLight;
  private readonly baseHemi = 2.4;
  private readonly baseKey = 2.6;
  private readonly baseHeadlamp = 10;

  private addLights(): void {
    // Bright sky/ground hemisphere for a daylight feel without an HDRI.
    this.hemi = new THREE.HemisphereLight(0xeaf0ff, 0x8a8375, this.baseHemi);
    this.scene.add(this.hemi);

    const key = new THREE.DirectionalLight(0xfff2d6, this.baseKey);
    key.position.set(30, 60, 20);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 300;
    const s = 60;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    this.key = key;

    // A headlamp on the camera lights whatever you're looking at — the reliable
    // fix for pitch-dark interiors the sun/sky can't reach.
    this.headlamp = new THREE.PointLight(0xffffff, this.baseHeadlamp, 25, 2);
    this.camera.add(this.headlamp);
  }

  /** Scale all lights by a per-world factor (1 = default). */
  setBrightness(factor: number): void {
    const f = Math.max(0.1, factor);
    this.hemi.intensity = this.baseHemi * f;
    this.key.intensity = this.baseKey * f;
    this.headlamp.intensity = this.baseHeadlamp * f;
  }

  /** Replace whatever model is loaded with a new one and drop the walker into it. */
  private mountModel(model: LoadedModel): void {
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      disposeObject(this.currentModel);
    }
    this.currentModel = model.scene;
    this.scene.add(model.scene);

    this.fp.setColliders(model.scene, model.bounds);

    // Keep fog very far out so zooming back to see the whole scene doesn't fade it
    // to darkness — it's just a soft distance cue, not "nighttime".
    const reach = Math.max(model.size.x, model.size.z);
    (this.scene.fog as THREE.Fog).near = reach * 2;
    (this.scene.fog as THREE.Fog).far = reach * 10;

    this.spawnInside(model);
  }

  /**
   * Drop the walker somewhere they can actually see the model. We probe a few
   * columns (centre first) for the lowest UP-FACING floor — an up-facing surface
   * so we don't spawn on the underside of a roof, lowest so we get the street /
   * ground floor rather than a rooftop. If no column has a floor (an open object
   * with nothing under the middle), we frame the whole model from outside instead
   * of stranding the camera in empty space staring at the void.
   */
  /** Re-drop the walker into the current model (used by the Recenter action). */
  recenter(): void {
    if (!this.currentModel) return;
    this.spawnInto(this.currentModel, new THREE.Box3().setFromObject(this.currentModel));
  }

  private spawnInside(model: LoadedModel): void {
    this.spawnInto(model.scene, model.bounds);
  }

  private spawnInto(root: THREE.Object3D, b: THREE.Box3): void {
    const center = new THREE.Vector3();
    b.getCenter(center);
    const size = new THREE.Vector3();
    b.getSize(size);

    const columns: Array<[number, number]> = [
      [center.x, center.z],
      [center.x - size.x * 0.25, center.z],
      [center.x + size.x * 0.25, center.z],
      [center.x, center.z - size.z * 0.25],
      [center.x, center.z + size.z * 0.25],
    ];

    for (const [x, z] of columns) {
      const floorY = this.floorAt(root, x, z, b.max.y + 1);
      if (floorY === null) continue;
      const pos = new THREE.Vector3(x, floorY + this.fp.eyeOffset, z);
      // Face the model's centre (kept horizontal) so there's geometry in view.
      const look = new THREE.Vector3(center.x, pos.y, center.z);
      if (look.distanceToSquared(pos) < 1) look.set(pos.x + 1, pos.y, pos.z);
      this.fp.teleport(pos);
      this.camera.lookAt(look);
      return;
    }

    // Nothing to stand on under any column: frame it from outside and look at it.
    const dist = Math.max(size.x, size.y, size.z) * 0.9 + 2;
    this.fp.teleport(new THREE.Vector3(center.x, b.max.y + size.y * 0.15, center.z + dist));
    this.camera.lookAt(center);
  }

  /** Lowest up-facing floor height under (x, z), or null if nothing is below. */
  private floorAt(root: THREE.Object3D, x: number, z: number, topY: number): number | null {
    this.pickRay.set(new THREE.Vector3(x, topY, z), new THREE.Vector3(0, -1, 0));
    this.pickRay.far = Infinity;
    const hits = this.pickRay.intersectObject(root, true);
    if (hits.length === 0) return null;
    // Walk from the lowest hit upward; take the first surface that faces up.
    for (let i = hits.length - 1; i >= 0; i--) {
      const hit = hits[i];
      if (!hit.face) return hit.point.y;
      this.normalMat.getNormalMatrix(hit.object.matrixWorld);
      const ny = new THREE.Vector3().copy(hit.face.normal).applyNormalMatrix(this.normalMat).normalize().y;
      if (ny > 0.3) return hit.point.y;
    }
    return hits[hits.length - 1].point.y; // no up-facing surface; use the lowest
  }

  async loadUrl(url: string): Promise<void> {
    this.currentAssetFile = url;
    this.mountModel(await loadGlbFromUrl(url));
  }

  async loadFile(file: File): Promise<void> {
    // A dropped file has no stable path; remember its name so a saved palace can
    // ask the user to re-drop it on load.
    this.currentAssetFile = file.name;
    this.mountModel(await loadGlbFromFile(file));
  }

  get assetFile(): string {
    return this.currentAssetFile;
  }

  /** Remove the current geometry (e.g. entering an empty nested palace). */
  clearModel(): void {
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      disposeObject(this.currentModel);
      this.currentModel = null;
    }
    this.currentAssetFile = '';
    this.fp.clearColliders();
  }

  /** Map an asset id to its live scene object (currently a single-asset app). */
  resolveAsset = (assetId: string): THREE.Object3D | null => {
    return assetId === DEFAULT_ASSET_ID ? this.currentModel : null;
  };

  /** Raycast forward from the crosshair (screen centre) onto the geometry. */
  raycastSurface(): SurfaceHit | null {
    if (!this.currentModel) return null;
    this.camera.getWorldDirection(this.camDir);
    this.pickRay.set(this.camera.position, this.camDir);
    const hits = this.pickRay.intersectObject(this.currentModel, true);
    if (hits.length === 0) return null;
    const hit = hits[0];
    const normal = new THREE.Vector3(0, 1, 0);
    if (hit.face) {
      // Face normals are object-local; bring them to world space via the normal matrix.
      this.normalMat.getNormalMatrix(hit.object.matrixWorld);
      normal.copy(hit.face.normal).applyNormalMatrix(this.normalMat).normalize();
      // Models often have outward-facing wall normals; flip so the normal points back
      // toward the player, so markers/portals sit on the side you're standing on.
      if (normal.dot(this.camDir) > 0) normal.negate();
    }
    return { point: hit.point.clone(), normal };
  }

  private scaleFigure: THREE.Sprite | null = null;
  private scaleShadow: THREE.Mesh | null = null;

  /**
   * Toggle a person-shaped scale reference. It stands squared-up beside the
   * current model — on the model's ground plane, at the face turned toward you —
   * so you can eyeball a 1.8 m person against the building as you slide the
   * player scale. A soft contact shadow keeps it planted on the floor. Returns
   * whether it is now visible.
   */
  toggleScaleFigure(playerScale: number): boolean {
    if (this.scaleFigure) {
      this.scene.remove(this.scaleFigure);
      (this.scaleFigure.material as THREE.SpriteMaterial).map?.dispose();
      this.scaleFigure.material.dispose();
      this.scaleFigure = null;
      if (this.scaleShadow) {
        this.scene.remove(this.scaleShadow);
        (this.scaleShadow.material as THREE.MeshBasicMaterial).map?.dispose();
        (this.scaleShadow.material as THREE.Material).dispose();
        this.scaleShadow.geometry.dispose();
        this.scaleShadow = null;
      }
      return false;
    }
    const fig = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: personTexture(), transparent: true, depthWrite: false, toneMapped: false }),
    );
    fig.center.set(0.5, 0); // anchor at the feet so it stands on the floor
    this.scene.add(fig);
    this.scaleFigure = fig;

    // A soft blob shadow so the figure reads as planted (sprites can't cast a
    // real shadow, so we fake the ground contact).
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 32),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    this.scene.add(shadow);
    this.scaleShadow = shadow;

    this.placeScaleFigure();
    this.setScaleFigureScale(playerScale);
    return true;
  }

  /** Position the figure on the model's ground, at the side facing the camera. */
  private placeScaleFigure(): void {
    if (!this.scaleFigure) return;
    let spot: THREE.Vector3;
    let floorY: number;
    if (this.currentModel) {
      const box = new THREE.Box3().setFromObject(this.currentModel);
      const center = box.getCenter(new THREE.Vector3());
      const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const dir = new THREE.Vector3().subVectors(this.camera.position, center);
      dir.y = 0;
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
      dir.normalize();
      // March from the centre out to whichever bounding face `dir` hits first.
      const tX = Math.abs(dir.x) > 1e-4 ? half.x / Math.abs(dir.x) : Infinity;
      const tZ = Math.abs(dir.z) > 1e-4 ? half.z / Math.abs(dir.z) : Infinity;
      const t = Math.min(tX, tZ);
      spot = center.addScaledVector(dir, t + 0.6); // stand just outside the wall
      floorY = box.min.y;
    } else {
      this.camera.getWorldDirection(this.camDir);
      spot = this.camera.position.clone().addScaledVector(new THREE.Vector3(this.camDir.x, 0, this.camDir.z).normalize(), 3);
      floorY = this.camera.position.y - this.fp.eyeOffset;
    }
    this.scaleFigure.position.set(spot.x, floorY, spot.z);
    if (this.scaleShadow) this.scaleShadow.position.set(spot.x, floorY + 0.02, spot.z);
  }

  setScaleFigureScale(playerScale: number): void {
    if (!this.scaleFigure) return;
    const h = 1.8 * playerScale; // an average person, scaled with the player
    this.scaleFigure.scale.set(0.42 * h, h, 1);
    if (this.scaleShadow) this.scaleShadow.scale.setScalar(Math.max(0.35, 0.42 * h));
  }

  /** Apply a palace's environment (background + fog colour), or the default. */
  private bgTexture: THREE.Texture | null = null;

  applyEnvironment(env?: Environment): void {
    if (this.bgTexture) {
      this.bgTexture.dispose();
      this.bgTexture = null;
    }
    const pattern = env?.pattern ? BACKGROUND_PATTERNS.find((p) => p.id === env.pattern) : null;
    if (pattern) {
      this.bgTexture = gradientTexture(pattern.top, pattern.bottom);
      this.scene.background = this.bgTexture;
      (this.scene.fog as THREE.Fog).color.set(pattern.bottom);
    } else {
      const color = new THREE.Color(env?.background || DEFAULT_BACKGROUND);
      this.scene.background = color;
      (this.scene.fog as THREE.Fog).color.copy(color);
    }
    this.setBrightness(env?.brightness ?? 1);
    this.fp.setScale(env?.playerScale ?? 1);
  }

  /** Point the camera at a target from a given position (used by review mode). */
  teleportTo(position: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.fp.teleport(position);
    this.camera.lookAt(lookAt);
  }

  /** Run a callback every rendered frame (e.g. the editor updating its crosshair target). */
  onFrame(cb: (dt: number) => void): void {
    this.frameCallbacks.push(cb);
  }

  start(): void {
    this.clock.start();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      // Clamp dt so a background tab that pauses rAF doesn't teleport us on return.
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.fp.update(dt);
      for (const cb of this.frameCallbacks) cb(dt);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.fp.dispose();
    if (this.currentModel) disposeObject(this.currentModel);
    this.renderer.dispose();
  }
}

/** A simple gender-neutral person silhouette for the scale reference. */
function personTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255, 207, 92, 0.92)';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 4;
  const cx = 64;
  // head
  ctx.beginPath();
  ctx.arc(cx, 40, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // body (torso + tapered to legs) + arms as a simple silhouette
  ctx.beginPath();
  ctx.moveTo(cx - 26, 78);
  ctx.lineTo(cx + 26, 78); // shoulders
  ctx.lineTo(cx + 20, 150); // waist right
  ctx.lineTo(cx + 22, 248); // leg right out
  ctx.lineTo(cx + 6, 248);
  ctx.lineTo(cx, 170); // crotch
  ctx.lineTo(cx - 6, 248);
  ctx.lineTo(cx - 22, 248); // leg left out
  ctx.lineTo(cx - 20, 150);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft round blob for the scale figure's fake contact shadow. */
function blobShadowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** A vertical top->bottom gradient as a background texture. */
function gradientTexture(top: string, bottom: string): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Free GPU memory for a subtree before we drop it. */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }
  });
}
