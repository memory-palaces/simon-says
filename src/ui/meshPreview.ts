import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * A small self-contained 3D preview: shows a generated mesh with orbit controls so
 * the user can spin a 360 view in the sidebar. One instance is reused and re-parented
 * into whichever locus detail is open; it only renders while its canvas is on-screen.
 */
export class MeshPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly loader = new GLTFLoader();
  private model: THREE.Object3D | null = null;
  private currentUrl: string | null = null;

  private static readonly W = 244;
  private static readonly H = 200;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(MeshPreview.W, MeshPreview.H);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(45, MeshPreview.W / MeshPreview.H, 0.01, 100);
    this.camera.position.set(0, 0.3, 2.6);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 3, 2);
    this.scene.add(key);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableZoom = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 2.2;

    this.animate();
  }

  /** Mount into `container` and show `glbDataUrl` (reloads only when it changes). */
  attach(container: HTMLElement, glbDataUrl: string): void {
    container.appendChild(this.renderer.domElement);
    if (glbDataUrl !== this.currentUrl) {
      this.currentUrl = glbDataUrl;
      void this.load(glbDataUrl);
    }
  }

  private async load(url: string): Promise<void> {
    const gltf = await this.loader.loadAsync(url);
    if (this.currentUrl !== url) return; // superseded while loading
    if (this.model) {
      this.scene.remove(this.model);
      disposeSubtree(this.model);
    }
    const obj = gltf.scene;
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const scale = 1.7 / (Math.max(size.x, size.y, size.z) || 1);
    obj.scale.setScalar(scale);
    obj.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    // Match the in-world self-lit look so the preview isn't dull.
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial) {
            if (m.map) m.emissiveMap = m.map;
            m.emissive = new THREE.Color(0xffffff);
            m.emissiveIntensity = 0.4;
          }
        }
      }
    });
    this.scene.add(obj);
    this.model = obj;
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    // Only draw while the canvas is actually in the DOM (a detail panel is open).
    if (!this.renderer.domElement.isConnected) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}

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
