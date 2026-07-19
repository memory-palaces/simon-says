import * as THREE from 'three';
import { FirstPersonControls } from './FirstPersonControls';
import { loadGlbFromUrl, loadGlbFromFile, type LoadedModel } from './loadGlb';
import { DEFAULT_ASSET_ID } from '../model/palace';

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

    this.scene.background = new THREE.Color(0x0a0a0b);
    this.scene.fog = new THREE.Fog(0x0a0a0b, 60, 200);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 1000);
    this.camera.position.set(0, 1.7, 0);

    this.addLights();
    this.fp = new FirstPersonControls(this.camera, this.renderer.domElement);
    this.scene.add(this.fp.controls.object);

    window.addEventListener('resize', this.onResize);
  }

  private addLights(): void {
    // Soft ambient so nothing is pure black, plus one key light casting shadows.
    // Sky/ground hemisphere gives interiors a believable fill without HDRI setup.
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2b2620, 1.1));

    const key = new THREE.DirectionalLight(0xfff2d6, 2.2);
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
   * Pick a spawn point: horizontal centre of the model, standing on the LOWEST
   * surface directly below (street / ground floor, not a rooftop the top-down ray
   * hits first). Falls back to the bounding-box floor if the ray misses entirely.
   */
  private spawnInside(model: LoadedModel): void {
    const center = new THREE.Vector3();
    model.bounds.getCenter(center);

    const ray = new THREE.Raycaster(
      new THREE.Vector3(center.x, model.bounds.max.y + 1, center.z),
      new THREE.Vector3(0, -1, 0),
    );
    const hits = ray.intersectObject(model.scene, true);
    const floorY = hits.length > 0 ? hits[hits.length - 1].point.y : model.bounds.min.y;

    this.fp.teleport(new THREE.Vector3(center.x, floorY + this.fp.eyeOffset, center.z));
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
