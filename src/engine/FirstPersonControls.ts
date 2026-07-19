import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/**
 * Quake-style first-person movement: WASD to move on the ground plane, mouse to
 * look. Collision is deliberately dumb per the spec — raycast DOWN to sit on the
 * floor, raycast in the MOVE direction to stop at walls. No physics engine.
 *
 * All distances are in world units (the imported model's own units — usually
 * metres for architectural glTF). Coordinates here are world-space; loci storage
 * elsewhere is asset-local, but movement doesn't care about that.
 */
export class FirstPersonControls {
  readonly controls: PointerLockControls;

  private readonly camera: THREE.PerspectiveCamera;

  /** Meshes we test against for floor and walls. Swapped when the model changes. */
  private colliders: THREE.Object3D[] = [];

  // Movement tuning. Scaled to the loaded model in `configureForSize`.
  private eyeHeight = 1.7; // camera height above the feet, in world units
  private walkSpeed = 4.0; // units/second on the ground
  private runMultiplier = 2.2; // hold Shift
  private collisionRadius = 0.35; // how close a wall can get before we stop
  private stepHeight = 0.6; // vertical lip we can climb without jumping
  private gravity = 18.0; // units/second^2 downward pull

  // Runtime state.
  private readonly velocityY = { v: 0 };
  private readonly keys = new Set<string>();
  private onGround = false;

  // Reusable scratch objects — allocating inside the animation loop causes GC hitches.
  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly moveDir = new THREE.Vector3();
  private readonly ray = new THREE.Raycaster();

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = new PointerLockControls(camera, domElement);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /** Point collision at a freshly loaded model. */
  setColliders(root: THREE.Object3D): void {
    this.colliders = [root];
  }

  /** Place the walker somewhere sensible and reset fall velocity. */
  teleport(position: THREE.Vector3): void {
    this.camera.position.copy(position);
    this.velocityY.v = 0;
  }

  get locked(): boolean {
    return this.controls.isLocked;
  }

  lock(): void {
    this.controls.lock();
  }

  /**
   * Derive movement scale from the model size so a dollhouse and a cathedral both
   * feel walkable. Called once per model load.
   */
  configureForSize(longestSide: number): void {
    // A human is ~1.7 units tall in a metric model; if the model is far larger or
    // smaller than that assumption, nudge speed/eye-height to stay proportional.
    const scale = THREE.MathUtils.clamp(longestSide / 40, 0.25, 6);
    this.walkSpeed = 4.0 * scale;
    this.eyeHeight = 1.7 * scale;
    this.collisionRadius = 0.35 * scale;
    this.stepHeight = 0.6 * scale;
  }

  get eyeOffset(): number {
    return this.eyeHeight;
  }

  /** Advance one frame. `dt` is seconds since the last frame (clamped by caller). */
  update(dt: number): void {
    // Look direction only matters while locked, but movement math is cheap enough
    // to always run; we just skip applying keys when unlocked.
    const speed =
      this.walkSpeed * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? this.runMultiplier : 1);

    // Build a ground-plane basis from where the camera is looking.
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.crossVectors(this.forward, this.camera.up).normalize();

    this.moveDir.set(0, 0, 0);
    if (this.controls.isLocked) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.moveDir.add(this.forward);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.moveDir.sub(this.forward);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.moveDir.add(this.right);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.moveDir.sub(this.right);
    }

    const wantsMove = this.moveDir.lengthSq() > 0;
    if (wantsMove) {
      this.moveDir.normalize();
      const step = speed * dt;
      // Wall check: cast from eye level in the move direction. If something is
      // within collisionRadius + step, don't advance (simple stop, no sliding).
      if (!this.blockedTowards(this.moveDir)) {
        this.camera.position.addScaledVector(this.moveDir, step);
      }
    }

    // Gravity + floor snapping. Cast down from slightly above the feet so a small
    // step lip counts as ground rather than a wall.
    this.applyGravityAndFloor(dt);
  }

  private blockedTowards(dir: THREE.Vector3): boolean {
    if (this.colliders.length === 0) return false;
    const origin = this.camera.position.clone();
    origin.y -= this.eyeHeight * 0.5; // test around chest height, not the ceiling
    this.ray.set(origin, dir);
    this.ray.far = this.collisionRadius + this.walkSpeed * 0.05;
    const hits = this.ray.intersectObjects(this.colliders, true);
    return hits.length > 0;
  }

  private applyGravityAndFloor(dt: number): void {
    if (this.colliders.length === 0) return;

    this.velocityY.v -= this.gravity * dt;
    this.camera.position.y += this.velocityY.v * dt;

    // Cast down from above the head so we always start outside the floor mesh.
    const origin = this.camera.position.clone();
    origin.y += this.stepHeight;
    this.ray.set(origin, this.down);
    this.ray.far = this.eyeHeight + this.stepHeight * 2;
    const hits = this.ray.intersectObjects(this.colliders, true);

    if (hits.length > 0) {
      const groundY = hits[0].point.y;
      const targetEyeY = groundY + this.eyeHeight;
      if (this.camera.position.y <= targetEyeY) {
        this.camera.position.y = targetEyeY;
        this.velocityY.v = 0;
        this.onGround = true;
        return;
      }
    }
    this.onGround = false;
  }

  get grounded(): boolean {
    return this.onGround;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controls.dispose();
  }
}
