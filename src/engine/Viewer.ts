import * as THREE from 'three';
import { FirstPersonControls } from './FirstPersonControls';
import { loadGlbFromUrl, loadGlbFromFile, type LoadedModel } from './loadGlb';
import { DEFAULT_ASSET_ID, DEFAULT_BACKGROUND, type Environment } from '../model/palace';

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

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 1000);
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
  private readonly baseHemi = 1.4;
  private readonly baseKey = 2.2;
  private readonly baseHeadlamp = 12;

  private addLights(): void {
    // Sky/ground hemisphere gives interiors a believable fill without an HDRI.
    this.hemi = new THREE.HemisphereLight(0xdbe6ff, 0x4a443c, this.baseHemi);
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

    // Fog distance should track the size of the space so big scenes don't clip.
    const reach = Math.max(model.size.x, model.size.z);
    (this.scene.fog as THREE.Fog).near = reach * 0.6;
    (this.scene.fog as THREE.Fog).far = reach * 2.2;

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
    }
    return { point: hit.point.clone(), normal };
  }

  /** Apply a palace's environment (background + fog colour), or the default. */
  applyEnvironment(env?: Environment): void {
    const color = new THREE.Color(env?.background || DEFAULT_BACKGROUND);
    (this.scene.background as THREE.Color).copy(color);
    (this.scene.fog as THREE.Fog).color.copy(color);
    this.setBrightness(env?.brightness ?? 1);
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
