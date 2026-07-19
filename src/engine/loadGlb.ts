import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface LoadedModel {
  /** The root object to add to the scene. */
  scene: THREE.Group;
  /** World-space bounding box, useful for framing the camera and picking a spawn. */
  bounds: THREE.Box3;
  /** Longest horizontal dimension — a rough sense of scale for movement speed. */
  size: THREE.Vector3;
}

const loader = new GLTFLoader();

/** Load a GLB/glTF from a URL (works for bundled samples and object URLs alike). */
export async function loadGlbFromUrl(url: string): Promise<LoadedModel> {
  const gltf = await loader.loadAsync(url);
  return finalize(gltf.scene);
}

/**
 * Load a GLB from a File the user dropped or picked. We hand GLTFLoader an
 * object URL and revoke it once parsing is done so we don't leak blob memory.
 */
export async function loadGlbFromFile(file: File): Promise<LoadedModel> {
  const url = URL.createObjectURL(file);
  try {
    const gltf = await loader.loadAsync(url);
    return finalize(gltf.scene);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function finalize(scene: THREE.Group): LoadedModel {
  // Make every surface a shadow participant and ensure normals exist for raycasts.
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  const bounds = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  return { scene, bounds, size };
}
