import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/**
 * Quake-style first-person movement: WASD to move, mouse to look. Collision is
 * deliberately dumb per the spec — raycast DOWN to sit on the floor, raycast in
 * the MOVE direction to stop at walls. No physics engine.
 *
 * Units: glTF's convention is 1 unit = 1 metre, and imported architectural models
 * honour it, so we use fixed human-scale constants (1.7 m eye height, ~5 m/s walk)
 * rather than scaling to the model's overall size. Scaling to model span is wrong:
 * a city model is hundreds of metres across but a person walking it is still 1.7 m
 * tall — deriving eye height from the span makes you float storeys above the street.
 *
 * Press F to toggle a fly/noclip mode (no gravity, no collision) — handy for large
 * or open models, and for getting un-stuck.
 */
export class FirstPersonControls {
  readonly controls: PointerLockControls;

  private readonly camera: THREE.PerspectiveCamera;

  /** Meshes we test against for floor and walls. Swapped when the model changes. */
  private colliders: THREE.Object3D[] = [];

  // Movement tuning — fixed, human scale (metres / seconds). Not model-dependent.
  private readonly eyeHeight = 1.7; // camera height above the feet
  private readonly walkSpeed = 5.0; // ground speed
  private readonly flySpeed = 12.0; // free-fly speed
  private readonly runMultiplier = 2.5; // hold Shift
  private readonly collisionRadius = 0.3; // how close a wall can get before we stop
  private readonly stepHeight = 0.5; // vertical lip we can climb without jumping
  private readonly gravity = 20.0; // m/s^2 downward pull
  private readonly jumpSpeed = 6.5; // launch velocity for a Space jump (~1 m hop)

  // Set per model at load. The ground probe must reach the lowest floor from any
  // height in the model, and we clamp falls so walking off the map can't drop you
  // into an endless void.
  private groundProbeFar = 2000;
  private floorFloorY = -Infinity; // absolute lowest we allow the feet to fall to

  // Runtime state.
  private velocityY = 0;
  private onGround = false;
  private flying = false;
  private readonly keys = new Set<string>();

  // Reusable scratch — allocating inside the animation loop causes GC hitches.
  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly moveDir = new THREE.Vector3();
  private readonly probeOrigin = new THREE.Vector3();
  private readonly ray = new THREE.Raycaster();

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = new PointerLockControls(camera, domElement);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /** Point collision at a freshly loaded model and size the ground probe to it. */
  setColliders(root: THREE.Object3D, bounds: THREE.Box3): void {
    this.colliders = [root];
    const height = bounds.max.y - bounds.min.y;
    this.groundProbeFar = height + 50; // reach the lowest floor from the highest roof
    this.floorFloorY = bounds.min.y - 5; // a little slack below the model's base
  }

  /** Place the walker somewhere sensible and reset fall velocity. */
  teleport(position: THREE.Vector3): void {
    this.camera.position.copy(position);
    this.velocityY = 0;
    this.onGround = false;
  }

  get eyeOffset(): number {
    return this.eyeHeight;
  }

  get grounded(): boolean {
    return this.onGround;
  }

  get mode(): 'walk' | 'fly' {
    return this.flying ? 'fly' : 'walk';
  }

  get locked(): boolean {
    return this.controls.isLocked;
  }

  lock(): void {
    this.controls.lock();
  }

  /** Advance one frame. `dt` is seconds since the last frame (clamped by caller). */
  update(dt: number): void {
    if (!this.controls.isLocked) return; // ignore movement keys until the cursor is captured

    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    if (this.flying) {
      this.updateFly(dt, running);
    } else {
      this.updateWalk(dt, running);
    }
  }

  private updateFly(dt: number, running: boolean): void {
    const speed = this.flySpeed * (running ? this.runMultiplier : 1);

    // Full 3D look direction — flying means W follows where you're looking.
    this.camera.getWorldDirection(this.forward).normalize();
    this.right.crossVectors(this.forward, this.camera.up).normalize();

    this.moveDir.set(0, 0, 0);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.moveDir.add(this.forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.moveDir.sub(this.forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.moveDir.add(this.right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.moveDir.sub(this.right);
    if (this.keys.has('Space')) this.moveDir.y += 1;
    if (this.keys.has('KeyC') || this.keys.has('ControlLeft')) this.moveDir.y -= 1;

    if (this.moveDir.lengthSq() > 0) {
      this.moveDir.normalize();
      this.camera.position.addScaledVector(this.moveDir, speed * dt);
    }
    this.velocityY = 0;
    this.onGround = false;
  }

  private updateWalk(dt: number, running: boolean): void {
    const speed = this.walkSpeed * (running ? this.runMultiplier : 1);

    // Ground-plane basis from where the camera is looking (ignore pitch).
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.crossVectors(this.forward, this.camera.up).normalize();

    this.moveDir.set(0, 0, 0);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.moveDir.add(this.forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.moveDir.sub(this.forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.moveDir.add(this.right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.moveDir.sub(this.right);

    if (this.moveDir.lengthSq() > 0) {
      this.moveDir.normalize();
      // Wall check: cast from chest height in the move direction. Simple stop, no
      // sliding, per spec. Small radius so we only stop when actually at a wall.
      if (!this.blockedTowards(this.moveDir)) {
        this.camera.position.addScaledVector(this.moveDir, speed * dt);
      }
    }

    this.applyGravityAndFloor(dt);
  }

  private blockedTowards(dir: THREE.Vector3): boolean {
    if (this.colliders.length === 0) return false;
    // Chest height: half an eye-height below the camera, so we don't catch the floor
    // or a ceiling, just walls in front of the torso.
    this.probeOrigin.copy(this.camera.position);
    this.probeOrigin.y -= this.eyeHeight * 0.5;
    this.ray.set(this.probeOrigin, dir);
    this.ray.far = this.collisionRadius + this.walkSpeed * 0.08;
    return this.ray.intersectObjects(this.colliders, true).length > 0;
  }

  private applyGravityAndFloor(dt: number): void {
    if (this.colliders.length === 0) return;

    const feetY = this.camera.position.y - this.eyeHeight;

    // Probe DOWN starting just above the feet (feet + stepHeight). Starting at the
    // feet — not the head — means an interior ceiling above us is never mistaken for
    // ground, while a low step still sits below the origin and reads as floor.
    this.probeOrigin.set(this.camera.position.x, feetY + this.stepHeight, this.camera.position.z);
    this.ray.set(this.probeOrigin, this.down);
    this.ray.far = this.groundProbeFar;
    const hits = this.ray.intersectObjects(this.colliders, true);

    if (hits.length === 0) {
      // Nothing below (off the edge of the map) — fall, but clamp so it isn't endless.
      this.fall(dt);
      if (this.camera.position.y - this.eyeHeight <= this.floorFloorY) {
        this.camera.position.y = this.floorFloorY + this.eyeHeight;
        this.velocityY = 0;
        this.onGround = true;
      }
      return;
    }

    const groundY = hits[0].point.y;
    const targetEyeY = groundY + this.eyeHeight;

    if (this.camera.position.y <= targetEyeY) {
      // At or below stand height (walking on ground, or stepping up a small lip).
      if (this.keys.has('Space')) {
        // Quake-style jump: launch upward, leave the ground this frame.
        this.velocityY = this.jumpSpeed;
        this.camera.position.y += this.velocityY * dt;
        this.onGround = false;
      } else {
        this.camera.position.y = targetEyeY;
        this.velocityY = 0;
        this.onGround = true;
      }
    } else {
      // Above the ground by more than a step — airborne. Fall toward it, then land.
      this.fall(dt);
      if (this.camera.position.y <= targetEyeY) {
        this.camera.position.y = targetEyeY;
        this.velocityY = 0;
        this.onGround = true;
      } else {
        this.onGround = false;
      }
    }
  }

  private fall(dt: number): void {
    this.velocityY -= this.gravity * dt;
    this.camera.position.y += this.velocityY * dt;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'KeyF') {
      this.flying = !this.flying;
      this.velocityY = 0;
      return;
    }
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
