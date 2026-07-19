import * as THREE from 'three';
import { FirstPersonControls } from './FirstPersonControls';
import { loadGlbFromUrl, loadGlbFromFile, type LoadedModel } from './loadGlb';

/**
 * Owns the renderer, scene, camera and the render loop. Everything spatial lives
 * here. Step 1 of the build order: load a GLB and walk it in first person.
 */
export class Viewer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly fp: FirstPersonControls;

  private currentModel: THREE.Group | null = null;
  private readonly clock = new THREE.Clock();
  private raf = 0;

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

    this.fp.setColliders(model.scene);
    this.fp.configureForSize(Math.max(model.size.x, model.size.z));

    // Fog distance should track the size of the space so big scenes don't clip.
    const reach = Math.max(model.size.x, model.size.z);
    (this.scene.fog as THREE.Fog).near = reach * 0.6;
    (this.scene.fog as THREE.Fog).far = reach * 2.2;

    this.spawnInside(model);
  }

  /**
   * Pick a spawn point: horizontal centre of the model, dropped onto the highest
   * floor found directly below. Falls back to the bounding-box centre if the
   * downward ray misses (e.g. an open model with no floor under the centre).
   */
  private spawnInside(model: LoadedModel): void {
    const center = new THREE.Vector3();
    model.bounds.getCenter(center);

    const ray = new THREE.Raycaster(
      new THREE.Vector3(center.x, model.bounds.max.y + 1, center.z),
      new THREE.Vector3(0, -1, 0),
    );
    const hits = ray.intersectObject(model.scene, true);
    const floorY = hits.length > 0 ? hits[0].point.y : model.bounds.min.y;

    this.fp.teleport(new THREE.Vector3(center.x, floorY + this.fp.eyeOffset, center.z));
  }

  async loadUrl(url: string): Promise<void> {
    this.mountModel(await loadGlbFromUrl(url));
  }

  async loadFile(file: File): Promise<void> {
    this.mountModel(await loadGlbFromFile(file));
  }

  start(): void {
    this.clock.start();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      // Clamp dt so a background tab that pauses rAF doesn't teleport us on return.
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.fp.update(dt);
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
