import './style.css';
import * as THREE from 'three';
import { Viewer } from './engine/Viewer';
import { LociLayer } from './engine/Loci';
import { Overlay } from './ui/overlay';
import { EditorPanel } from './ui/editorPanel';
import { ReviewOverlay } from './ui/review';
import { openPalace, readPalaceFile, savePalace } from './model/persistence';
import { loadDraft, saveDraft } from './model/autosave';
import { History } from './model/history';
import { GenerateDialog } from './ui/generateDialog';
import {
  getBackend,
  listBackends,
  loadGenerationSettings,
  NONE_ID,
  saveGenerationSettings,
  type GenerationSettings,
} from './model/generation';
import {
  addLocus,
  createEmptyPalace,
  DEFAULT_ASSET_ID,
  lociInOrder,
  removeLocus,
  reorderLocus,
  setAsset,
  type Locus,
  type Palace,
} from './model/palace';

// Bundled zero-config sample so the app renders the instant it's cloned.
const DEFAULT_SPACE = { url: 'assets/samples/virtualcity/VirtualCity.glb', name: 'Virtual City (sample)' };

type Mode = 'edit' | 'walk' | 'review';

class App {
  private readonly mount = document.getElementById('app')!;
  private readonly viewer = new Viewer(this.mount);
  private readonly loci = new LociLayer(this.viewer.scene, this.viewer.resolveAsset);
  private readonly overlay = new Overlay(this.mount);
  private readonly editor: EditorPanel;
  private readonly review = new ReviewOverlay(this.mount);
  private readonly generateDialog = new GenerateDialog(this.mount);

  private genSettings: GenerationSettings = loadGenerationSettings();

  private palace: Palace = createEmptyPalace('My palace');
  private mode: Mode = 'edit';
  private selectedId: string | null = null;
  private targetedId: string | null = null;
  private movingId: string | null = null;

  // Review flow state.
  private reviewRoute: Locus[] = [];
  private reviewIndex = 0;
  private reviewRevealed = false;

  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();

  private draftTimer = 0;

  private readonly history = new History<Palace>(100);
  private histTimer = 0;
  private histPending = false;

  constructor() {
    this.editor = new EditorPanel(this.mount, {
      renamePalace: (name) => {
        this.palace.name = name;
        this.checkpointSoon();
      },
      enterWalk: () => this.enterWalk(),
      save: () => savePalace(this.palace),
      load: () => this.loadViaPicker(),
      newPalace: () => this.newPalace(),
      startReview: () => this.beginReview(),
      selectLocus: (id) => this.select(id),
      // rerender=false: re-rendering the panel on every keystroke would drop input
      // focus. The panel updates the affected row text in place instead. History is
      // checkpointed on a debounce so one Ctrl+Z doesn't rewind character-by-character.
      updateLabel: (id, text) => {
        this.mutateLocus(id, (l) => (l.label = text), false);
        this.checkpointSoon();
      },
      updatePrompt: (id, text) => {
        this.mutateLocus(id, (l) => (l.image_prompt = text), false);
        this.checkpointSoon();
      },
      reorder: (id, dir) => this.reorder(id, dir),
      deleteLocus: (id) => this.deleteLocus(id),
      teleport: (id) => this.gotoLocus(id),
      undo: () => this.undo(),
      redo: () => this.redo(),
      setBackground: (hex) => this.setBackground(hex),
      setBackendId: (id) => this.setBackendId(id),
      generate: (id) => this.generateFor(id),
      clearImage: (id) => this.clearImage(id),
    });
    this.editor.setGeneration(this.backendOptions(), this.genSettings.backendId);

    this.viewer.start();
    this.viewer.onFrame(() => this.onFrame());
    this.wireEvents();
    this.boot();
  }

  private async boot(): Promise<void> {
    // Restore an autosaved draft if one exists — never make the user start over
    // because of a refresh or crash.
    const draft = loadDraft();
    if (draft) {
      await this.adoptPalace(draft);
      this.history.reset(this.palace); // draft is the baseline; nothing to undo past it
      return;
    }

    this.overlay.showLoading(DEFAULT_SPACE.name);
    try {
      await this.viewer.loadUrl(DEFAULT_SPACE.url);
      setAsset(this.palace, DEFAULT_SPACE.url);
      this.viewer.applyEnvironment(this.palace.environment);
      this.loci.sync(this.palace);
      this.history.reset(this.palace);
      this.setMode('edit');
    } catch (err) {
      console.error(err);
      this.overlay.showError(
        `Couldn't load the sample space. If you opened the file directly, run a local server (see README). ` +
          `You can still drag your own .glb onto the window.`,
      );
    }
  }

  // --- Mode machine ----------------------------------------------------------

  private setMode(mode: Mode): void {
    this.mode = mode;
    if (mode === 'walk') {
      this.editor.hide();
      this.review.hide();
      this.overlay.hide();
      this.overlay.setCrosshair(true);
    } else if (mode === 'edit') {
      this.overlay.setCrosshair(false);
      this.overlay.setHud('');
      this.review.hide();
      this.overlay.hide();
      this.movingId = null;
      this.editor.render(this.palace, this.selectedId, this.history.canUndo(), this.history.canRedo());
      this.editor.show();
    } else {
      // review — the overlay is driven by the review flow itself.
      this.editor.hide();
      this.overlay.setCrosshair(false);
      this.overlay.setHud('');
      this.overlay.hide();
    }
  }

  private enterWalk(): void {
    if (!this.viewer.fp.locked) this.viewer.fp.lock();
  }

  /** Queue a debounced autosave. Called after every change to the palace. */
  private markDirty(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => saveDraft(this.palace), 400);
  }

  /** Write the draft immediately (on tab close / hide, where a timer wouldn't fire). */
  private flushDraft(): void {
    clearTimeout(this.draftTimer);
    saveDraft(this.palace);
  }

  // --- Undo/redo history -----------------------------------------------------

  /** Record an undo checkpoint now (for discrete actions like place/delete/reorder). */
  private checkpoint(): void {
    this.histPending = false;
    clearTimeout(this.histTimer);
    this.history.push(this.palace);
    this.markDirty();
    this.editor.setHistoryState(this.history.canUndo(), this.history.canRedo());
  }

  /** Record a checkpoint after a short pause — coalesces rapid text edits into one step. */
  private checkpointSoon(): void {
    this.histPending = true;
    clearTimeout(this.histTimer);
    this.histTimer = window.setTimeout(() => {
      this.histPending = false;
      this.history.push(this.palace);
      this.markDirty();
      this.editor.setHistoryState(this.history.canUndo(), this.history.canRedo());
    }, 700);
  }

  /** Fold any pending (debounced) text edit into the history before undoing past it. */
  private flushCheckpoint(): void {
    if (!this.histPending) return;
    this.histPending = false;
    clearTimeout(this.histTimer);
    this.history.push(this.palace);
  }

  private undo(): void {
    this.flushCheckpoint();
    const snap = this.history.undo();
    if (snap) this.applySnapshot(snap);
  }

  private redo(): void {
    const snap = this.history.redo();
    if (snap) this.applySnapshot(snap);
  }

  /** Replace the live palace with a restored snapshot and refresh everything. */
  private applySnapshot(snapshot: Palace): void {
    this.palace = snapshot;
    if (this.selectedId && !this.palace.loci.some((l) => l.id === this.selectedId)) this.selectedId = null;
    this.movingId = null;
    this.targetedId = null;
    this.loci.setTargeted(null);
    this.loci.setSelected(this.selectedId);
    this.loci.sync(this.palace);
    this.viewer.applyEnvironment(this.palace.environment);
    this.markDirty();
    if (this.mode === 'edit') {
      this.editor.render(this.palace, this.selectedId, this.history.canUndo(), this.history.canRedo());
    } else {
      this.editor.setHistoryState(this.history.canUndo(), this.history.canRedo());
    }
  }

  /** Select the marker under the crosshair and drop back to the editor for it. */
  private openTargetedInEditor(): void {
    if (!this.targetedId) return;
    this.selectedId = this.targetedId;
    this.loci.setSelected(this.selectedId);
    // Unlocking fires the 'unlock' handler -> setMode('edit'), which renders the
    // panel with this locus selected and its detail fields open.
    if (this.viewer.fp.locked) this.viewer.fp.controls.unlock();
    else this.setMode('edit');
  }

  private wireEvents(): void {
    this.viewer.fp.controls.addEventListener('lock', () => this.setMode('walk'));
    this.viewer.fp.controls.addEventListener('unlock', () => {
      if (this.mode === 'walk') this.setMode('edit');
    });

    // Click the 3D view to start walking; while walking, click a marker you're
    // looking at to jump straight to its editor.
    this.viewer.renderer.domElement.addEventListener('click', () => {
      if (this.mode === 'edit') this.enterWalk();
      else if (this.mode === 'walk' && this.targetedId && !this.movingId) this.openTargetedInEditor();
    });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('drop', (e) => this.onDrop(e));

    // Belt-and-suspenders autosave: flush the draft when the tab is hidden or
    // closed, in case the debounce timer hasn't fired yet.
    window.addEventListener('beforeunload', () => this.flushDraft());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushDraft();
    });
  }

  // --- Per-frame: crosshair targeting + move + HUD ---------------------------

  private onFrame(): void {
    if (this.mode === 'walk') {
      const hit = this.viewer.raycastSurface();
      if (this.movingId && hit) {
        // Grabbed locus follows the crosshair across the surface.
        const local = this.loci.worldToLocal(DEFAULT_ASSET_ID, hit.point, hit.normal);
        this.mutateLocus(this.movingId, (l) => {
          l.local_position = local.position;
          l.local_normal = local.normal;
        }, false);
        this.loci.sync(this.palace);
      } else {
        // Highlight whatever marker the crosshair is over.
        const id = this.loci.pick(this.crosshairRay());
        this.targetedId = id;
        this.loci.setTargeted(id);
      }
      this.updateWalkHud();
    }
  }

  private readonly _ray = new THREE.Raycaster();
  private crosshairRay(): THREE.Raycaster {
    this.viewer.camera.getWorldDirection(this.scratchA);
    this._ray.set(this.viewer.camera.position, this.scratchA);
    this._ray.far = 30;
    return this._ray;
  }

  private updateWalkHud(): void {
    const n = this.palace.loci.length;
    const parts = [`${n} ${n === 1 ? 'locus' : 'loci'}`];
    if (this.movingId) parts.push('moving — [E] drop');
    else if (this.targetedId) parts.push('marker — [X] delete  [G] move');
    else parts.push('[E] drop a locus');
    parts.push(this.viewer.fp.mode === 'fly' ? 'fly' : 'walk');
    this.overlay.setHud(parts.join('   ·   '));
  }

  // --- Walk-mode keys --------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    // Undo/redo, available in every mode. While the caret is in a text field, let
    // the browser's native text undo win instead of rewinding the whole palace.
    if (e.ctrlKey || e.metaKey) {
      const target = e.target as HTMLElement | null;
      const inField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      const key = e.key.toLowerCase();
      if (!inField && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) this.redo();
        else this.undo();
        return;
      }
    }

    if (this.mode === 'walk') {
      if (e.code === 'KeyE') this.dropOrPlace();
      else if (e.code === 'KeyX') this.deleteTargeted();
      else if (e.code === 'KeyG') this.toggleMove();
    } else if (this.mode === 'review') {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        this.reviewAdvance();
      } else if (e.code === 'Escape') {
        this.endReview();
      }
    }
  }

  private dropOrPlace(): void {
    if (this.movingId) {
      this.movingId = null; // drop the grabbed one where it currently sits
      this.checkpoint();
      return;
    }
    const hit = this.viewer.raycastSurface();
    if (!hit) return;
    const local = this.loci.worldToLocal(DEFAULT_ASSET_ID, hit.point, hit.normal);
    const locus = addLocus(this.palace, local.position, local.normal);
    this.selectedId = locus.id;
    this.loci.sync(this.palace);
    this.checkpoint();
  }

  private deleteTargeted(): void {
    if (!this.targetedId) return;
    const id = this.targetedId;
    if (this.movingId === id) this.movingId = null;
    if (this.selectedId === id) this.selectedId = null;
    this.targetedId = null;
    removeLocus(this.palace, id);
    this.loci.setTargeted(null);
    this.loci.sync(this.palace);
    this.checkpoint();
  }

  private toggleMove(): void {
    if (this.movingId) {
      this.movingId = null;
      this.checkpoint(); // finalise the moved position as one undo step
    } else if (this.targetedId) {
      this.movingId = this.targetedId;
      this.selectedId = this.targetedId;
      this.loci.setSelected(this.targetedId);
    }
  }

  // --- Editor handlers -------------------------------------------------------

  /** Re-render the panel, always carrying the current undo/redo enablement. */
  private renderEditor(): void {
    this.editor.render(this.palace, this.selectedId, this.history.canUndo(), this.history.canRedo());
  }

  private select(id: string): void {
    this.selectedId = id;
    this.loci.setSelected(id);
    this.renderEditor();
  }

  private mutateLocus(id: string, fn: (l: Locus) => void, rerender = true): void {
    const locus = this.palace.loci.find((l) => l.id === id);
    if (!locus) return;
    fn(locus);
    this.markDirty();
    if (rerender && this.mode === 'edit') this.renderEditor();
  }

  private reorder(id: string, dir: -1 | 1): void {
    reorderLocus(this.palace, id, dir);
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  private deleteLocus(id: string): void {
    if (this.selectedId === id) this.selectedId = null;
    removeLocus(this.palace, id);
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  private setBackground(hex: string): void {
    this.palace.environment = { background: hex };
    this.viewer.applyEnvironment(this.palace.environment);
    this.markDirty();
    this.checkpointSoon(); // coalesce colour-picker dragging into one undo step
  }

  // --- Generation ------------------------------------------------------------

  private backendOptions(): Array<{ id: string; label: string }> {
    return [{ id: NONE_ID, label: 'None (text only)' }, ...listBackends().map((b) => ({ id: b.id, label: b.label }))];
  }

  private setBackendId(id: string): void {
    this.genSettings = { backendId: id };
    saveGenerationSettings(this.genSettings);
    this.editor.setGeneration(this.backendOptions(), id);
    this.renderEditor();
  }

  /** Render the locus's own words to a 2D image via the active backend, verbatim. */
  private generateFor(id: string): void {
    const backend = getBackend(this.genSettings.backendId);
    if (!backend) return;
    const locus = this.palace.loci.find((l) => l.id === id);
    if (!locus || !locus.image_prompt.trim()) return;

    this.generateDialog.open(locus.image_prompt, {
      generate: (seed) => backend.generateImage(locus.image_prompt, seed),
      onApprove: (dataUrl) => {
        locus.image_2d = dataUrl;
        this.loci.sync(this.palace);
        this.checkpoint();
        this.renderEditor();
      },
    });
  }

  private clearImage(id: string): void {
    const locus = this.palace.loci.find((l) => l.id === id);
    if (!locus) return;
    locus.image_2d = null;
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  private newPalace(): void {
    if (this.palace.loci.length > 0 && !confirm('Start a new palace? This clears the current draft. Use Save first to keep it.')) return;
    const name = this.palace.name;
    this.palace = createEmptyPalace(name);
    setAsset(this.palace, this.viewer.assetFile);
    this.selectedId = null;
    this.viewer.applyEnvironment(this.palace.environment);
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  // --- Review flow -----------------------------------------------------------

  private beginReview(): void {
    this.reviewRoute = lociInOrder(this.palace);
    if (this.reviewRoute.length === 0) return;
    this.reviewIndex = 0;
    this.reviewRevealed = false;
    this.setMode('review');
    this.showReviewStep();
  }

  private showReviewStep(): void {
    const locus = this.reviewRoute[this.reviewIndex];
    this.gotoLocusObject(locus);
    this.review.showCue(this.reviewIndex + 1, this.reviewRoute.length, locus.label);
  }

  private reviewAdvance(): void {
    // Past the last locus: the "done" card is showing — Space exits.
    if (this.reviewIndex >= this.reviewRoute.length) {
      this.endReview();
      return;
    }
    const locus = this.reviewRoute[this.reviewIndex];
    if (!this.reviewRevealed) {
      this.reviewRevealed = true;
      locus.last_reviewed = new Date().toISOString();
      this.markDirty();
      const isLast = this.reviewIndex === this.reviewRoute.length - 1;
      this.review.showReveal(this.reviewIndex + 1, this.reviewRoute.length, locus.label, locus.image_prompt, isLast);
      return;
    }
    // Advance to the next locus (or the done card).
    this.reviewIndex += 1;
    this.reviewRevealed = false;
    if (this.reviewIndex >= this.reviewRoute.length) {
      this.review.showDone(this.reviewRoute.length);
    } else {
      this.showReviewStep();
    }
  }

  private endReview(): void {
    this.setMode('edit');
  }

  private gotoLocus(id: string): void {
    const locus = this.palace.loci.find((l) => l.id === id);
    if (locus) this.gotoLocusObject(locus);
  }

  /** Position the camera a couple of metres off the locus, looking at it. */
  private gotoLocusObject(locus: Locus): void {
    const pos = this.loci.worldPosition(locus, this.scratchA);
    const normal = this.loci.worldNormal(locus, this.scratchB);
    // Stand back along the surface normal, but keep it mostly horizontal so we
    // don't end up above a floor locus or below a ceiling one.
    const horiz = new THREE.Vector3(normal.x, 0, normal.z);
    if (horiz.lengthSq() < 0.02) horiz.set(0, 0, 1);
    horiz.normalize();
    const viewPos = pos.clone().addScaledVector(horiz, 2.2);
    viewPos.y = pos.y + 0.8;
    this.viewer.teleportTo(viewPos, pos);
  }

  // --- Drag & drop / load ----------------------------------------------------

  private async onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.(glb|gltf)$/i.test(file.name)) await this.loadGeometry(file);
    else if (/\.json$/i.test(file.name)) await this.loadPalaceFile(file);
    else this.overlay.showError(`"${file.name}" isn't a .glb, .gltf, or .json file.`);
  }

  /** Swap the geometry but KEEP the loci — asset-local coords make them survive. */
  private async loadGeometry(file: File): Promise<void> {
    this.overlay.showLoading(file.name);
    try {
      await this.viewer.loadFile(file);
      setAsset(this.palace, file.name);
      this.editor.setNotice(null); // geometry is present now
      this.loci.sync(this.palace);
      this.checkpoint();
      this.finishLoad();
    } catch (err) {
      console.error(err);
      this.overlay.showError(`Couldn't load "${file.name}". It may reference external textures a single file can't include.`);
    }
  }

  private async loadPalaceFile(file: File): Promise<void> {
    try {
      const palace = await readPalaceFile(file);
      await this.adoptPalace(palace);
      this.checkpoint(); // loading is undoable (recover from an accidental Load)
    } catch (err) {
      console.error(err);
      this.overlay.showError(`Couldn't read "${file.name}" as a palace file.`);
    }
  }

  private async loadViaPicker(): Promise<void> {
    try {
      const palace = await openPalace();
      if (palace) {
        await this.adoptPalace(palace);
        this.checkpoint();
      }
    } catch (err) {
      console.error(err);
      this.overlay.showError('Could not open that palace file.');
    }
  }

  /** Load a palace, then try to bring in its geometry (or ask the user to drop it). */
  private async adoptPalace(palace: Palace): Promise<void> {
    this.palace = palace;
    this.selectedId = null;
    this.viewer.applyEnvironment(this.palace.environment);
    const asset = palace.assets.find((a) => a.id === DEFAULT_ASSET_ID) ?? palace.assets[0];
    const file = asset?.file ?? '';

    // Try to auto-load bundled/URL assets; a bare dropped filename can't be fetched.
    this.editor.setNotice(null);
    if (/^(https?:|\.?\/|assets\/)/.test(file)) {
      this.overlay.showLoading(file);
      try {
        await this.viewer.loadUrl(file);
      } catch {
        this.editor.setNotice(`Palace loaded. Now drag its geometry file ("${file}") onto the window to see the markers.`);
      }
    } else if (file) {
      this.editor.setNotice(`Palace "${palace.name}" loaded. Now drag its geometry file ("${file}") onto the window to see the markers.`);
    }
    this.loci.sync(this.palace);
    this.markDirty();
    this.finishLoad();
  }

  /** Common tail after any load: return to the editor with a clean state. */
  private finishLoad(): void {
    if (this.viewer.fp.locked) this.viewer.fp.controls.unlock();
    this.setMode('edit');
  }
}

new App();
