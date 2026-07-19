import './style.css';
import { Viewer } from './engine/Viewer';
import { Overlay } from './ui/overlay';

// The bundled sample that ships with the repo so the app renders something the
// instant it's cloned — the spec's zero-config default. Path is relative because
// vite.config sets base:'./'.
const DEFAULT_SPACE = {
  url: 'assets/samples/virtualcity/VirtualCity.glb',
  name: 'Virtual City (sample)',
};

const mount = document.getElementById('app')!;
const viewer = new Viewer(mount);
const overlay = new Overlay(mount);

let currentSpaceName = DEFAULT_SPACE.name;

viewer.start();
boot();

async function boot(): Promise<void> {
  overlay.showLoading(DEFAULT_SPACE.name);
  try {
    await viewer.loadUrl(DEFAULT_SPACE.url);
    currentSpaceName = DEFAULT_SPACE.name;
    overlay.showStart(currentSpaceName);
  } catch (err) {
    console.error(err);
    overlay.showError(
      `Couldn't load the sample space. If you're opening the file directly, run a local server instead ` +
        `(see the README). You can still drag your own .glb onto the window.`,
    );
  }
}

// --- Pointer lock wiring ----------------------------------------------------

overlay.onResume = () => viewer.fp.lock();

viewer.fp.controls.addEventListener('lock', () => {
  overlay.hide();
  overlay.setCrosshair(true);
});

viewer.fp.controls.addEventListener('unlock', () => {
  overlay.setCrosshair(false);
  overlay.showStart(currentSpaceName);
});

// --- Drag & drop to load your own space -------------------------------------

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!/\.(glb|gltf)$/i.test(file.name)) {
    overlay.showError(`"${file.name}" isn't a .glb or .gltf file.`);
    return;
  }
  overlay.showLoading(file.name);
  try {
    await viewer.loadFile(file);
    currentSpaceName = file.name;
    overlay.showStart(currentSpaceName);
  } catch (err) {
    console.error(err);
    overlay.showError(`Couldn't load "${file.name}". It may reference external textures a single file can't include.`);
  }
});

// --- HUD: position + grounded state, updated a few times a second -----------

setInterval(() => {
  const p = viewer.camera.position;
  const mode = viewer.fp.mode;
  const state = mode === 'fly' ? 'fly' : viewer.fp.grounded ? 'floor' : 'air';
  overlay.setHud(
    `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}   ·   ${state}   ·   ${currentSpaceName}`,
  );
}, 120);
