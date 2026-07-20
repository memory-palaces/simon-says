import './style.css';
import * as THREE from 'three';
import { Viewer } from './engine/Viewer';
import { fileToDataUrl } from './engine/loadGlb';
import { LociLayer } from './engine/Loci';
import { Overlay } from './ui/overlay';
import { EditorPanel } from './ui/editorPanel';
import { ReviewOverlay } from './ui/review';
import { openPalace, readPalaceFile, savePalace } from './model/persistence';
import { loadDraft, saveDraft } from './model/autosave';
import { History } from './model/history';
import { GenerateDialog } from './ui/generateDialog';
import { SettingsDialog } from './ui/settingsDialog';
import { Toasts } from './ui/toasts';
import { openGoToDialog } from './ui/goToDialog';
import { MeshPreview } from './ui/meshPreview';
import { HelpOverlay } from './ui/help';
import { MapOverlay } from './ui/mapOverlay';
import { chooseAction } from './ui/choice';
import {
  applyStyle,
  DEFAULT_FAL_MODEL,
  DEFAULT_LOCAL_URL,
  DEFAULT_LOCAL_WORKFLOW,
  getBackend,
  listBackends,
  loadGenerationSettings,
  NONE_ID,
  saveGenerationSettings,
  testLocalConnection,
  type FalConfig,
  type GenerationSettings,
  type LocalConfig,
} from './model/generation';
import {
  addAttachment,
  addLocus,
  addPortal,
  createEmptyPalace,
  DEFAULT_ASSET_ID,
  DEFAULT_BACKGROUND,
  lociInOrder,
  migratePalace,
  removeLocus,
  reorderLocus,
  setAsset,
  type Locus,
  type Palace,
  type Vec3,
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
  private readonly toasts = new Toasts(this.mount);
  private readonly generateDialog = new GenerateDialog(this.mount);
  private readonly meshPreview = new MeshPreview();
  private readonly helpOverlay = new HelpOverlay(this.mount);
  private readonly mapOverlay = new MapOverlay(this.mount, (path) => void this.jumpToWorld(path));
  private readonly settingsDialog = new SettingsDialog(this.mount, {
    setFalConfig: (apiKey, model) => this.setFalConfig(apiKey, model),
    setLocalConfig: (url, workflow) => this.setLocalConfig(url, workflow),
    testLocal: () => this.testLocal(),
  });

  private genSettings: GenerationSettings = loadGenerationSettings();
  /** Session-only history of rendered images per locus, so rerolls aren't lost. */
  private readonly sessionImages = new Map<string, string[]>();

  /** The palace currently being viewed/edited (may be a nested child). */
  private palace: Palace = createEmptyPalace('My palace');
  /** The top-level palace. Save, autosave and undo history all operate on this. */
  private root: Palace = this.palace;
  /** Descent path through portals, with the camera state to return to each level. */
  private navStack: Array<{ portalId: string; camPos: THREE.Vector3; camQuat: THREE.Quaternion; flying: boolean }> = [];
  private targetedPortalId: string | null = null;
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
  /** False when there are edits since the last explicit Save or load. */
  private savedClean = true;
  /** The file this palace is bound to (File System Access), so Save writes back to it. */
  private fileHandle: FileSystemFileHandle | null = null;

  private readonly history = new History<Palace>(100);
  private histTimer = 0;
  private histPending = false;

  /** Full-screen fade used to mask scene swaps (entering/leaving a child palace). */
  private readonly fadeEl = document.createElement('div');
  private fadeMs = 180; // tunable via the console

  constructor() {
    this.fadeEl.className = 'fade';
    this.mount.appendChild(this.fadeEl);
    this.editor = new EditorPanel(this.mount, {
      renamePalace: (name) => {
        this.palace.name = name;
        this.checkpointSoon();
      },
      enterWalk: () => this.enterWalk(),
      save: () => this.save(),
      load: () => this.loadViaPicker(),
      newPalace: () => this.newPalace(),
      startReview: () => this.beginReview(),
      openSettings: () => this.settingsDialog.open(this.genConfig()),
      openLog: () => this.toasts.openLog(),
      recenter: () => this.viewer.recenter(),
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
      setPattern: (id) => this.setPattern(id),
      setBrightness: (v) => this.setBrightness(v),
      setPlayerScale: (v) => this.setPlayerScale(v),
      setBackendId: (id) => this.setBackendId(id),
      generate: (id) => this.generateFor(id),
      clearImage: (id) => this.clearImage(id),
      generate3d: (id) => this.generate3dFor(id),
      clearMesh: (id) => this.clearMesh(id),
      mountMeshPreview: (container, url) => this.meshPreview.attach(container, url),
      updateNotes: (id, text) => {
        this.mutateLocus(id, (l) => (l.notes = text), false);
        this.checkpointSoon();
      },
      attachImage: (id) => this.attachFile(id, 'image'),
      attachMesh: (id) => this.attachFile(id, 'mesh'),
      selectAttachment: (id, i) => this.selectAttachment(id, i),
      removeAttachment: (id, i) => this.removeAttachment(id, i),
      setObjectScale: (id, v) => this.setObjectScale(id, v),
      setObjectRotation: (id, axis, v) => this.setObjectRotation(id, axis, v),
      setStyle: (id) => this.setStyle(id),
      setFalModel: (model) => this.setFalModel(model),
      enterPortal: (id) => void this.enterPortal(id),
      removePortal: (id) => this.removePortal(id),
      renamePortal: (id, name) => this.renamePortal(id, name),
      gotoPortal: (id) => this.gotoPortal(id),
      returnToParent: () => this.returnToParent(),
    });
    this.syncGeneration();

    this.toasts.setTunables([
      { id: 'marker', label: 'Marker size', min: 0.3, max: 3, step: 0.1, value: 1, onChange: (v) => { this.loci.setMarkerScale(v); this.loci.sync(this.palace); } },
      { id: 'glow', label: 'Mesh glow', min: 0, max: 1, step: 0.05, value: 0.45, onChange: (v) => this.loci.setMeshEmissive(v) },
      { id: 'fade', label: 'Fade ms', min: 0, max: 600, step: 20, value: this.fadeMs, onChange: (v) => (this.fadeMs = v) },
    ]);

    this.viewer.start();
    this.viewer.onFrame(() => this.onFrame());
    this.wireEvents();
    this.boot();
  }

  private async boot(): Promise<void> {
    // Restore an autosaved draft if one exists — never make the user start over
    // because of a refresh or crash.
    const draft = await loadDraft();
    if (draft) {
      await this.adoptPalace(draft);
      // A restored draft was autosaved but never written to a file, so treat it as
      // unsaved: New/Load will offer to Save it first.
      this.savedClean = draft.loci.length === 0;
      return;
    }

    this.overlay.showLoading(DEFAULT_SPACE.name);
    try {
      await this.viewer.loadUrl(DEFAULT_SPACE.url);
      setAsset(this.palace, DEFAULT_SPACE.url);
      this.viewer.applyEnvironment(this.palace.environment);
      this.loci.sync(this.palace);
      this.history.reset(this.root);
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
      this.overlay.setTooltip(null);
      this.review.hide();
      this.overlay.hide();
      this.movingId = null;
      this.renderEditor();
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
    // Enter flying so clicking in never drops you off a ledge / into the void —
    // you keep exactly the vantage you had. Press F for gravity-walk.
    this.viewer.fp.setFlying(true);
    if (!this.viewer.fp.locked) this.viewer.fp.lock();
  }

  /** Queue a debounced autosave. Called after every change to the palace. */
  private markDirty(): void {
    this.savedClean = false; // there are now changes not written to a file
    clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => saveDraft(this.root), 400);
  }

  /** Save back to the bound file (or Save As the first time). Ctrl+S. */
  private async save(forceNew = false): Promise<void> {
    const outcome = await savePalace(this.root, forceNew ? null : this.fileHandle);
    if (outcome.status === 'cancelled') return;
    if (outcome.status === 'handle') this.fileHandle = outcome.handle;
    this.savedClean = true;
    this.toasts.success(
      outcome.status === 'handle' ? `Saved “${this.root.name}”` : `Downloaded “${this.root.name}.json”`,
    );
  }

  /**
   * Before an action that discards the current work (New / Load), offer to save.
   * Returns true if the caller should proceed. Autosave keeps a draft, but that
   * draft is about to be overwritten, so this guards real data loss.
   */
  private async confirmDiscard(title: string): Promise<boolean> {
    if (this.savedClean || this.palace.loci.length === 0) return true;
    const choice = await chooseAction(this.mount, {
      title,
      message: `You have unsaved changes in “${this.palace.name}”.`,
      choices: [
        { id: 'save', label: 'Save, then continue', sublabel: 'Exports a .json first', variant: 'primary' },
        { id: 'discard', label: 'Continue without saving' },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    if (choice === null || choice === 'cancel') return false;
    if (choice === 'save') await this.save();
    return true;
  }

  /** Write the draft immediately (on tab close / hide, where a timer wouldn't fire). */
  private flushDraft(): void {
    clearTimeout(this.draftTimer);
    saveDraft(this.root);
  }

  // --- Undo/redo history -----------------------------------------------------

  /** Record an undo checkpoint now (for discrete actions like place/delete/reorder). */
  private checkpoint(): void {
    this.histPending = false;
    clearTimeout(this.histTimer);
    this.history.push(this.root);
    this.markDirty();
    this.editor.setHistoryState(this.history.canUndo(), this.history.canRedo());
  }

  /** Record a checkpoint after a short pause — coalesces rapid text edits into one step. */
  private checkpointSoon(): void {
    this.histPending = true;
    clearTimeout(this.histTimer);
    this.histTimer = window.setTimeout(() => {
      this.histPending = false;
      this.history.push(this.root);
      this.markDirty();
      this.editor.setHistoryState(this.history.canUndo(), this.history.canRedo());
    }, 700);
  }

  /** Fold any pending (debounced) text edit into the history before undoing past it. */
  private flushCheckpoint(): void {
    if (!this.histPending) return;
    this.histPending = false;
    clearTimeout(this.histTimer);
    this.history.push(this.root);
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

  /**
   * Replace the ROOT with a restored snapshot and refresh. Undo/redo snapshot the
   * whole tree; to keep this simple we surface at the root view (v1 limitation:
   * undo while inside a nested child returns you to the top level).
   */
  private applySnapshot(snapshot: Palace): void {
    const reload = this.navStack.length > 0 || snapshot.assets[0]?.file !== this.viewer.assetFile;
    this.root = snapshot;
    this.palace = snapshot;
    this.navStack = [];
    if (this.selectedId && !this.palace.loci.some((l) => l.id === this.selectedId)) this.selectedId = null;
    this.movingId = null;
    this.targetedId = null;
    this.loci.setTargeted(null);
    this.loci.setSelected(this.selectedId);
    this.viewer.applyEnvironment(this.palace.environment);
    if (reload) {
      void this.enterPalaceGeometry();
    } else {
      this.loci.sync(this.palace);
    }
    this.markDirty();
    this.updateReturnUi();
    if (this.mode === 'edit') this.renderEditor();
    else this.editor.setHistoryState(this.history.canUndo(), this.history.canRedo());
  }

  /** Ctrl/Cmd+G: jump to a locus by number or name. */
  private openGoTo(): void {
    if (this.palace.loci.length === 0) {
      this.toasts.info('No loci to go to yet.');
      return;
    }
    // Release the pointer so the user can type into the palette.
    if (this.viewer.fp.locked) this.viewer.fp.controls.unlock();
    const items = lociInOrder(this.palace).map((l) => ({ id: l.id, order: l.order, label: l.label }));
    openGoToDialog(this.mount, items, (id) => {
      this.gotoLocus(id);
      // Fly in at the pin so you don't immediately drop off an upper floor.
      this.viewer.fp.setFlying(true);
      this.enterWalk();
      const l = this.palace.loci.find((x) => x.id === id);
      if (l) this.toasts.info(`Jumped to #${l.order}${l.label ? ` — ${l.label}` : ''}`);
    });
  }

  private toggleXray(): void {
    const on = !this.loci.xrayOn;
    this.loci.setXray(on);
    this.toasts.info(on ? 'X-ray on — all pins show through walls' : 'X-ray off — pins hidden behind walls');
  }

  /** Walk-mode click: enter a targeted portal, else open the targeted locus editor. */
  private clickTargeted(): void {
    if (this.targetedPortalId) {
      void this.enterPortal(this.targetedPortalId);
    } else if (this.targetedId) {
      this.openTargetedInEditor();
    }
  }

  /** Mouse-wheel dolly along the view direction (quick zoom), scaled to the player. */
  private onWheel(e: WheelEvent): void {
    if (!this.viewer.fp.locked) return; // let the editor panel scroll normally
    e.preventDefault();
    this.viewer.camera.getWorldDirection(this.scratchA);
    const step = -e.deltaY * 0.02 * (this.viewer.fp.eyeOffset / 1.7);
    this.viewer.camera.position.addScaledVector(this.scratchA, step);
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

    const canvas = this.viewer.renderer.domElement;
    // Click the 3D view to start walking; while walking, click a marker you're
    // looking at — a doorway pin enters its inner palace, otherwise open its editor.
    canvas.addEventListener('click', () => {
      if (this.mode === 'edit') this.enterWalk();
      else if (this.mode === 'walk' && !this.movingId && (this.targetedId || this.targetedPortalId)) this.clickTargeted();
    });
    // Right-click releases the mouse (like Esc), so you don't have to reach for it.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 && this.viewer.fp.locked) this.viewer.fp.controls.unlock();
    });
    // Mouse wheel dollies along the view direction — a quick zoom in/out.
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

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
    this.loci.update(); // pulse portal rings (all modes)
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
        // Highlight whatever the crosshair is over — a portal takes priority.
        const ray = this.crosshairRay();
        const portalId = this.loci.pickPortal(ray);
        const locusId = portalId ? null : this.loci.pick(ray);
        if (portalId !== this.targetedPortalId || locusId !== this.targetedId) {
          this.targetedPortalId = portalId;
          this.targetedId = locusId;
          this.loci.setTargeted(locusId);
          this.updateTooltip();
        }
      }
      this.updateWalkHud();
    }
  }

  /** Floating title (+ notes preview) near the crosshair for the aimed-at orb. */
  private updateTooltip(): void {
    if (this.targetedPortalId) {
      const p = this.palace.portals?.find((x) => x.id === this.targetedPortalId);
      const name = escapeHtml(p?.label || (p?.target ? p.target.name : 'New world'));
      this.overlay.setTooltip(`<div class="tt-title">Portal</div><div class="tt-door">↳ ${name} — Enter</div>`);
      return;
    }
    const t = this.targetedId ? this.palace.loci.find((l) => l.id === this.targetedId) : null;
    if (!t) {
      this.overlay.setTooltip(null);
      return;
    }
    const title = escapeHtml(t.label || `Locus ${t.order}`);
    const notes = t.notes?.trim();
    const notesHtml = notes ? `<div class="tt-notes">${escapeHtml(notes.slice(0, 140))}${notes.length > 140 ? '…' : ''}</div>` : '';
    this.overlay.setTooltip(`<div class="tt-title">${title}</div>${notesHtml}`);
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
    if (this.movingId) parts.push('moving — [T] drop');
    else if (this.targetedPortalId) parts.push('portal — [Enter] go through');
    else if (this.targetedId) {
      const t = this.palace.loci.find((l) => l.id === this.targetedId);
      const name = t?.label ? `“${t.label}”` : 'marker';
      parts.push(`${name} — [B] delete  [G] move`);
    } else parts.push('[T] locus · [P] portal · [?] help');
    if (this.navStack.length > 0) parts.push('[Q] return');
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
      if (key === 's') {
        e.preventDefault(); // don't let the browser "save page"
        void this.save(e.shiftKey); // Ctrl+Shift+S = Save As
        return;
      }
      if (key === 'g') {
        e.preventDefault();
        this.openGoTo();
        return;
      }
      if (!inField && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) this.redo();
        else this.undo();
        return;
      }
    }

    // '?' shows the controls cheat-sheet in any mode.
    if (e.key === '?') {
      e.preventDefault();
      this.helpOverlay.toggle();
      return;
    }

    // 'M' toggles the world map (unless typing).
    const mt = e.target as HTMLElement | null;
    const inFieldNow = !!mt && (mt.tagName === 'INPUT' || mt.tagName === 'TEXTAREA');
    if (!inFieldNow && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      this.mapOverlay.toggle(this.root, this.navStack.map((f) => f.portalId));
      return;
    }

    // [ / ] jump to the previous / next locus (unless typing in a field).
    const tgt = e.target as HTMLElement | null;
    const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA');
    if (!typing && (e.key === '[' || e.key === ']')) {
      e.preventDefault();
      this.selectAdjacent(e.key === ']' ? 1 : -1);
      return;
    }

    if (this.mode === 'walk') {
      if (e.code === 'KeyT') this.dropOrPlace();
      else if (e.code === 'KeyB') this.deleteTargeted();
      else if (e.code === 'KeyG') this.toggleMove();
      else if (e.code === 'KeyR') this.viewer.recenter();
      else if (e.code === 'KeyX') this.toggleXray();
      else if (e.code === 'KeyP') this.placePortal();
      else if (e.code === 'Enter' && this.targetedPortalId) void this.enterPortal(this.targetedPortalId);
      else if (e.code === 'KeyQ') void this.returnToParent(); // Q, not Backspace (avoids browser-back)
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

  /** Push the current generation state (pipeline, 3D support, style, model) to the panel. */
  private syncGeneration(): void {
    this.editor.setGeneration({
      options: this.backendOptions(),
      activeId: this.activeBackendId(),
      can3d: getBackend(this.activeBackendId())?.can3d ?? false,
      styleId: this.palace.generation?.style ?? 'none',
      falModel: this.genSettings.fal?.model ?? DEFAULT_FAL_MODEL,
    });
  }

  /** Re-render the panel, carrying the current undo/redo state and world pipeline. */
  private renderEditor(): void {
    this.syncGeneration();
    this.editor.render(this.palace, this.selectedId, this.history.canUndo(), this.history.canRedo());
  }

  private select(id: string): void {
    this.selectedId = id || null; // '' collapses the open detail
    this.loci.setSelected(this.selectedId);
    this.renderEditor();
  }

  /** Cycle the selection to the previous/next locus and fly to it. */
  private selectAdjacent(dir: 1 | -1): void {
    const ordered = lociInOrder(this.palace);
    if (ordered.length === 0) return;
    const cur = ordered.findIndex((l) => l.id === this.selectedId);
    const i = cur < 0 ? (dir > 0 ? 0 : ordered.length - 1) : (cur + dir + ordered.length) % ordered.length;
    const l = ordered[i];
    this.selectedId = l.id;
    this.loci.setSelected(l.id);
    this.gotoLocus(l.id);
    if (this.mode === 'edit') this.renderEditor();
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
    // A solid colour clears any gradient pattern.
    this.palace.environment = { ...this.palace.environment, background: hex, pattern: undefined };
    this.viewer.applyEnvironment(this.palace.environment);
    this.markDirty();
    this.checkpointSoon(); // coalesce colour-picker dragging into one undo step
  }

  private setPattern(id: string): void {
    this.palace.environment = { ...(this.palace.environment ?? { background: DEFAULT_BACKGROUND }), pattern: id };
    this.viewer.applyEnvironment(this.palace.environment);
    this.markDirty();
    this.checkpoint();
    this.renderEditor(); // reflect which swatch is active
  }

  private setBrightness(value: number): void {
    this.palace.environment = { ...(this.palace.environment ?? { background: DEFAULT_BACKGROUND }), brightness: value };
    this.viewer.setBrightness(value);
    this.markDirty();
    this.checkpointSoon(); // coalesce slider dragging into one undo step
  }

  private setPlayerScale(value: number): void {
    this.palace.environment = { ...(this.palace.environment ?? { background: DEFAULT_BACKGROUND }), playerScale: value };
    this.viewer.fp.setScale(value);
    this.markDirty();
    this.checkpointSoon();
  }

  // --- Generation ------------------------------------------------------------

  private backendOptions(): Array<{ id: string; label: string }> {
    return [{ id: NONE_ID, label: 'None (text only)' }, ...listBackends().map((b) => ({ id: b.id, label: b.label }))];
  }

  private genConfig(): { local?: LocalConfig; fal?: FalConfig } {
    return { local: this.genSettings.local, fal: this.genSettings.fal };
  }

  /** The pipeline THIS world uses (per-world, stored in the palace). */
  private activeBackendId(): string {
    return this.palace.generation?.backendId ?? NONE_ID;
  }

  private setBackendId(id: string): void {
    // Pipeline choice is per-world, so it's saved with the palace and undoable.
    this.palace.generation = { backendId: id, style: this.palace.generation?.style };
    // Seed default local config the first time the local backend is chosen anywhere.
    if (id === 'local' && !this.genSettings.local) {
      this.genSettings.local = { url: DEFAULT_LOCAL_URL, imageWorkflow: DEFAULT_LOCAL_WORKFLOW };
      saveGenerationSettings(this.genSettings);
    }
    this.checkpoint();
    this.renderEditor();
  }

  private setStyle(id: string): void {
    this.palace.generation = { backendId: this.activeBackendId(), style: id };
    this.checkpoint();
    this.renderEditor();
  }

  private setFalModel(model: string): void {
    this.genSettings = { ...this.genSettings, fal: { apiKey: this.genSettings.fal?.apiKey ?? '', model } };
    saveGenerationSettings(this.genSettings);
    this.renderEditor();
  }

  private setLocalConfig(url: string, workflow: string): void {
    this.genSettings = { ...this.genSettings, local: { url, imageWorkflow: workflow } };
    saveGenerationSettings(this.genSettings);
  }

  private setFalConfig(apiKey: string, model: string): void {
    this.genSettings = { ...this.genSettings, fal: { apiKey, model } };
    saveGenerationSettings(this.genSettings);
  }

  /** Returns a human-readable status for the Settings dialog to display. */
  private async testLocal(): Promise<string> {
    const url = this.genSettings.local?.url ?? DEFAULT_LOCAL_URL;
    try {
      await testLocalConnection(url);
      return `Reachable at ${url} ✓`;
    } catch (err) {
      return err instanceof Error ? err.message : 'Connection failed.';
    }
  }

  /** Render the locus's own words to a 2D image via the active backend, verbatim. */
  private generateFor(id: string): void {
    // Fall back to the offline placeholder if this world has no pipeline chosen,
    // so Render always does something without forcing a settings change.
    const backend = getBackend(this.activeBackendId()) ?? getBackend('placeholder');
    if (!backend) return;
    const locus = this.palace.loci.find((l) => l.id === id);
    if (!locus || !locus.image_prompt.trim()) return;

    // Seed the dialog's history with this session's variants (or the saved image).
    let history = this.sessionImages.get(id);
    if (!history) {
      history = locus.image_2d ? [locus.image_2d] : [];
      this.sessionImages.set(id, history);
    }

    // The style is a rendering modifier appended under the hood; the dialog still
    // shows the user's own words. Their mnemonic text is never altered.
    const styledPrompt = applyStyle(locus.image_prompt, this.palace.generation?.style);
    this.generateDialog.open(locus.image_prompt, {
      variants: history,
      generate: (seed) => backend.generateImage(styledPrompt, seed),
      onGenerated: (dataUrl) => history.push(dataUrl),
      onApprove: (dataUrl) => {
        // A newly approved image becomes the representation; the old mesh (now stale
        // for this image) stays in the gallery so you can rotate back to it.
        locus.image_2d = dataUrl;
        locus.mesh_3d = null;
        addAttachment(locus, { type: 'image', src: dataUrl });
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

  /** Second stage: turn the approved image into a 3D mesh at the locus. */
  private async generate3dFor(id: string): Promise<void> {
    const backend = getBackend(this.activeBackendId());
    if (!backend?.imageTo3d) return;
    const locus = this.palace.loci.find((l) => l.id === id);
    if (!locus?.image_2d) return;

    // Multiple 3D jobs can run at once, so each gets its own floating toast that
    // resolves in place — no more missing a sidebar notice while scrolled.
    const label = snippet(locus.image_prompt || locus.label || `locus ${locus.order}`);
    const toast = this.toasts.show(`Rendering 3D — ${label}…`, 'info', { sticky: true });
    try {
      const glb = await backend.imageTo3d(locus.image_2d);
      locus.mesh_3d = glb;
      addAttachment(locus, { type: 'mesh', src: glb });
      this.loci.sync(this.palace);
      this.checkpoint();
      this.renderEditor();
      toast.update(`3D ready — ${label}`, 'success');
    } catch (err) {
      console.error(err);
      toast.update(`3D failed — ${label}: ${err instanceof Error ? err.message : 'error'}`, 'error');
    }
  }

  private clearMesh(id: string): void {
    const locus = this.palace.loci.find((l) => l.id === id);
    if (!locus) return;
    locus.mesh_3d = null;
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  /** Rotate the locus to a gallery item — an image (clears the mesh) or a mesh. */
  private selectAttachment(id: string, index: number): void {
    const locus = this.palace.loci.find((l) => l.id === id);
    const item = locus?.gallery?.[index];
    if (!locus || !item) return;
    if (item.type === 'image') {
      locus.image_2d = item.src;
      locus.mesh_3d = null;
    } else {
      locus.mesh_3d = item.src;
    }
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  private removeAttachment(id: string, index: number): void {
    const locus = this.palace.loci.find((l) => l.id === id);
    const item = locus?.gallery?.[index];
    if (!locus || !item) return;
    locus.gallery!.splice(index, 1);
    // If we removed the active representation, clear it.
    if (item.type === 'image' && locus.image_2d === item.src) locus.image_2d = null;
    if (item.type === 'mesh' && locus.mesh_3d === item.src) locus.mesh_3d = null;
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  /** Attach a user-supplied image or GLB (e.g. generated elsewhere in fal.ai). */
  private async attachFile(id: string, kind: 'image' | 'mesh'): Promise<void> {
    const file = await pickFile(kind === 'image' ? 'image/*' : '.glb,.gltf,model/gltf-binary');
    if (!file) return;
    const locus = this.palace.loci.find((l) => l.id === id);
    if (!locus) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      if (kind === 'image') {
        locus.image_2d = dataUrl;
        locus.mesh_3d = null; // attached image becomes the representation
        addAttachment(locus, { type: 'image', src: dataUrl });
        const hist = this.sessionImages.get(id) ?? [];
        hist.push(dataUrl);
        this.sessionImages.set(id, hist);
      } else {
        locus.mesh_3d = dataUrl;
        addAttachment(locus, { type: 'mesh', src: dataUrl });
      }
      this.loci.sync(this.palace);
      this.checkpoint();
      this.renderEditor();
      this.toasts.success(kind === 'image' ? 'Image attached' : '3D model attached');
    } catch (err) {
      console.error(err);
      this.toasts.error(`Couldn't attach "${file.name}"`);
    }
  }

  private setObjectScale(id: string, value: number): void {
    this.mutateLocus(id, (l) => (l.object_scale = value), false);
    this.loci.sync(this.palace);
    this.checkpointSoon();
  }

  private setObjectRotation(id: string, axis: number, value: number): void {
    this.mutateLocus(
      id,
      (l) => {
        const r: Vec3 = l.object_rotation ?? [0, 0, 0];
        r[axis] = value;
        l.object_rotation = r;
      },
      false,
    );
    this.loci.sync(this.palace);
    this.checkpointSoon();
  }

  private async newPalace(): Promise<void> {
    if (!(await this.confirmDiscard('Start a new world?'))) return;
    // A fresh palace gets a fresh name (not the previous one's) but keeps the model
    // currently loaded so you can start placing loci right away.
    this.palace = createEmptyPalace();
    this.root = this.palace;
    this.navStack = [];
    this.fileHandle = null;
    setAsset(this.palace, this.viewer.assetFile);
    this.selectedId = null;
    this.editor.setNotice(null); // clear any stale "drag the geometry" message
    this.viewer.applyEnvironment(this.palace.environment);
    this.loci.sync(this.palace);
    this.history.reset(this.root);
    this.markDirty();
    this.savedClean = true; // a fresh, empty palace has nothing unsaved to lose
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
    this.viewer.fp.setFlying(true); // float at the target, don't drop
    this.viewer.teleportTo(viewPos, pos);
  }

  // --- Portals (nested worlds) -----------------------------------------------

  /** Resolve the world at the current descent path (root -> portal target -> …). */
  private resolveCurrent(): Palace {
    let p = this.root;
    for (const frame of this.navStack) {
      const portal = p.portals?.find((pr) => pr.id === frame.portalId);
      if (!portal?.target) break;
      p = portal.target;
    }
    return p;
  }

  /** Load the current palace's geometry into the viewer, or clear it if none. */
  private async enterPalaceGeometry(): Promise<void> {
    const asset = this.palace.assets.find((a) => a.id === DEFAULT_ASSET_ID) ?? this.palace.assets[0];
    const file = asset?.file ?? '';
    this.viewer.applyEnvironment(this.palace.environment);
    this.editor.setNotice(null);
    if (/^(data:|https?:|\.?\/|assets\/)/.test(file)) {
      try {
        await this.viewer.loadUrl(file); // mountModel spawns us in
      } catch {
        this.editor.setNotice('Could not load this palace’s geometry.');
      }
    } else {
      this.viewer.clearModel();
      if (this.palace.loci.length === 0) {
        this.editor.setNotice('Empty inner world — drag a .glb onto the window to give it a space.');
      }
    }
    this.loci.sync(this.palace);
    // Callers render AFTER updateReturnUi so the breadcrumb/Return bar is fresh.
  }

  /** Fade to black, run the scene swap, fade back — like stepping through a door. */
  private async transition(swap: () => Promise<void>): Promise<void> {
    this.fadeEl.style.transitionDuration = `${this.fadeMs}ms`;
    this.fadeEl.classList.add('on');
    await wait(this.fadeMs);
    await swap();
    await wait(60); // let the new scene render a frame before fading back in
    this.fadeEl.classList.remove('on');
  }

  /** Drop a portal at the crosshair (its target world is created on first entry). */
  private placePortal(): void {
    const hit = this.viewer.raycastSurface();
    if (!hit) return;
    const local = this.loci.worldToLocal(DEFAULT_ASSET_ID, hit.point, hit.normal);
    addPortal(this.palace, local.position, local.normal);
    this.loci.sync(this.palace);
    this.checkpoint();
    this.toasts.info('Portal placed — aim at it and press Enter to go through');
  }

  /** Step through a portal into its target world (creating an empty one if needed). */
  private async enterPortal(portalId: string): Promise<void> {
    const portal = this.palace.portals?.find((p) => p.id === portalId);
    if (!portal) return;
    if (!portal.target) {
      const target = createEmptyPalace(portal.label || 'New world');
      if (this.palace.generation) target.generation = { ...this.palace.generation };
      portal.target = target;
      this.checkpoint();
    }
    const target = portal.target!;
    this.navStack.push({
      portalId,
      camPos: this.viewer.camera.position.clone(),
      camQuat: this.viewer.camera.quaternion.clone(),
      flying: this.viewer.fp.mode === 'fly',
    });
    await this.transition(async () => {
      this.palace = target;
      this.selectedId = null;
      await this.enterPalaceGeometry();
    });
    this.updateReturnUi();
    if (this.mode === 'edit') this.renderEditor();
    this.toasts.info(`Entered “${this.palace.name}” — Q to return`);
  }

  /** Pop back up to the parent world, restoring its geometry and camera. */
  private async returnToParent(): Promise<void> {
    const frame = this.navStack.pop();
    if (!frame) return;
    await this.transition(async () => {
      this.palace = this.resolveCurrent();
      this.selectedId = null;
      await this.enterPalaceGeometry();
      this.viewer.fp.setFlying(frame.flying);
      this.viewer.camera.position.copy(frame.camPos);
      this.viewer.camera.quaternion.copy(frame.camQuat);
    });
    this.updateReturnUi();
    if (this.mode === 'edit') this.renderEditor();
  }

  /** Jump directly to a world by its portal path (from the map). */
  private async jumpToWorld(path: string[]): Promise<void> {
    this.mapOverlay.hide();
    const frames: typeof this.navStack = [];
    let p = this.root;
    for (const portalId of path) {
      const portal = p.portals?.find((x) => x.id === portalId);
      if (!portal?.target) break;
      frames.push({
        portalId,
        camPos: this.viewer.camera.position.clone(),
        camQuat: this.viewer.camera.quaternion.clone(),
        flying: this.viewer.fp.mode === 'fly',
      });
      p = portal.target;
    }
    this.navStack = frames;
    const target = p;
    await this.transition(async () => {
      this.palace = target;
      this.selectedId = null;
      await this.enterPalaceGeometry();
    });
    this.updateReturnUi();
    if (this.mode === 'edit') this.renderEditor();
  }

  private removePortal(portalId: string): void {
    if (!this.palace.portals) return;
    this.palace.portals = this.palace.portals.filter((p) => p.id !== portalId);
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  private renamePortal(portalId: string, name: string): void {
    const portal = this.palace.portals?.find((p) => p.id === portalId);
    if (!portal) return;
    portal.label = name;
    this.checkpointSoon(); // no re-render: keep focus in the field
  }

  private gotoPortal(portalId: string): void {
    const portal = this.palace.portals?.find((p) => p.id === portalId);
    if (!portal) return;
    const pos = this.loci.worldPositionOfPortal(portal, this.scratchA);
    const normal = this.loci.worldNormal({ local_normal: portal.local_normal, asset_id: portal.asset_id } as Locus, this.scratchB);
    const horiz = new THREE.Vector3(normal.x, 0, normal.z);
    if (horiz.lengthSq() < 0.02) horiz.set(0, 0, 1);
    horiz.normalize();
    const viewPos = pos.clone().addScaledVector(horiz, 2.2);
    viewPos.y = pos.y + 0.8;
    this.viewer.fp.setFlying(true);
    this.viewer.teleportTo(viewPos, pos);
  }

  /** Tell the panel how deep we are so it can show a Return / breadcrumb bar. */
  private updateReturnUi(): void {
    const trail = [this.root.name, ...this.navStack.map((_, i) => this.worldNameAt(i + 1))];
    this.editor.setNesting(this.navStack.length, trail);
  }

  /** Name of the world at descent depth `depth` (0 = root). */
  private worldNameAt(depth: number): string {
    let p = this.root;
    for (let i = 0; i < depth && i < this.navStack.length; i++) {
      const portal = p.portals?.find((pr) => pr.id === this.navStack[i].portalId);
      if (!portal?.target) break;
      p = portal.target;
    }
    return p.name;
  }

  // --- Drag & drop / load ----------------------------------------------------

  private async onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    const glbs = files.filter((f) => /\.(glb|gltf)$/i.test(f.name));
    const json = files.find((f) => /\.json$/i.test(f.name));
    if (glbs.length > 1) await this.onMultiGlbDrop(glbs);
    else if (glbs.length === 1) await this.onGlbDrop(glbs[0]);
    else if (json) await this.loadPalaceFile(json);
    else this.overlay.showError(`Drop a .glb, .gltf, or .json file.`);
  }

  /** Drop several models at once: each becomes its own world, linked by a portal. */
  private async onMultiGlbDrop(files: File[]): Promise<void> {
    this.overlay.showLoading(`${files.length} models`);
    try {
      const n = files.length;
      let i = 0;
      for (const file of files) {
        const dataUrl = await fileToDataUrl(file);
        const child = createEmptyPalace(baseName(file.name));
        if (this.palace.generation) child.generation = { ...this.palace.generation };
        setAsset(child, dataUrl);
        // Spread the portals in a row in front of the origin so they don't overlap.
        const portal = addPortal(this.palace, [(i - (n - 1) / 2) * 2.6, 1.3, -3], [0, 0, 1]);
        portal.label = baseName(file.name);
        portal.target = child;
        i++;
      }
      this.loci.sync(this.palace);
      this.checkpoint();
      this.finishLoad();
      this.toasts.success(`Added ${n} worlds as portals — press M for the map`);
    } catch (err) {
      console.error(err);
      this.overlay.showError('Could not load one of the models.');
    }
  }

  /**
   * Dropping a GLB usually means "try a different space", not "update the same
   * one" — so when loci already exist we ask, rather than silently keeping loci
   * over a completely different model. With no loci there's nothing to lose, so we
   * just load it.
   */
  private async onGlbDrop(file: File): Promise<void> {
    // Inside a nested child, a dropped GLB always sets THIS child's geometry — never
    // start a new root palace (that would sever the nesting link).
    if (this.navStack.length > 0) {
      await this.swapGeometry(file);
      return;
    }
    if (this.palace.loci.length === 0) {
      // No loci yet: just set this palace's geometry, keeping the name the user
      // already chose. (A GLB filename shouldn't rename their project.)
      await this.swapGeometry(file);
      return;
    }
    const n = this.palace.loci.length;
    const choice = await chooseAction(this.mount, {
      title: `Load “${file.name}”`,
      message: `You have ${n} ${n === 1 ? 'locus' : 'loci'} in “${this.palace.name}”. This is probably a different space.`,
      choices: [
        { id: 'new', label: 'Start a new world with this model', sublabel: 'Discards the current loci', variant: 'primary' },
        { id: 'save-new', label: 'Save current, then start new', sublabel: 'Exports a .json first' },
        { id: 'replace', label: 'Keep my loci, just swap the model', sublabel: 'For an updated version of the same space' },
        { id: 'cancel', label: 'Cancel' },
      ],
    });

    if (choice === 'replace') await this.swapGeometry(file);
    else if (choice === 'new') await this.newPalaceWithGeometry(file);
    else if (choice === 'save-new') {
      await this.save();
      await this.newPalaceWithGeometry(file);
    }
  }

  /** Swap geometry but KEEP the loci — asset-local coords make them survive. */
  private async swapGeometry(file: File): Promise<void> {
    this.overlay.showLoading(file.name);
    try {
      // Embed the GLB as a data URL so the palace stays self-contained.
      const dataUrl = await fileToDataUrl(file);
      await this.viewer.loadUrl(dataUrl);
      setAsset(this.palace, dataUrl);
      this.editor.setNotice(null);
      this.loci.sync(this.palace);
      this.checkpoint();
      this.finishLoad();
    } catch (err) {
      console.error(err);
      this.overlay.showError(`Couldn't load "${file.name}". It may reference external textures a single file can't include.`);
    }
  }

  /** Start a fresh palace built on the dropped model. */
  private async newPalaceWithGeometry(file: File): Promise<void> {
    this.overlay.showLoading(file.name);
    try {
      const dataUrl = await fileToDataUrl(file);
      this.palace = createEmptyPalace(baseName(file.name));
      this.root = this.palace;
      this.navStack = [];
      this.fileHandle = null;
      this.selectedId = null;
      this.viewer.applyEnvironment(this.palace.environment);
      await this.viewer.loadUrl(dataUrl);
      setAsset(this.palace, dataUrl);
      this.editor.setNotice(null);
      this.loci.sync(this.palace);
      this.history.reset(this.root);
      this.markDirty();
      this.savedClean = true;
      this.finishLoad();
    } catch (err) {
      console.error(err);
      this.overlay.showError(`Couldn't load "${file.name}". It may reference external textures a single file can't include.`);
    }
  }

  private async loadPalaceFile(file: File): Promise<void> {
    if (!(await this.confirmDiscard(`Load “${file.name}”?`))) return;
    try {
      const palace = await readPalaceFile(file);
      this.fileHandle = null; // a dropped file isn't writable; Save will Save As
      await this.adoptPalace(palace);
    } catch (err) {
      console.error(err);
      this.overlay.showError(`Couldn't read "${file.name}" as a world file.`);
    }
  }

  private async loadViaPicker(): Promise<void> {
    if (!(await this.confirmDiscard('Load a world?'))) return;
    try {
      const opened = await openPalace();
      if (opened) {
        this.fileHandle = opened.handle; // save writes back to this file
        await this.adoptPalace(opened.palace);
      }
    } catch (err) {
      console.error(err);
      this.overlay.showError('Could not open that palace file.');
    }
  }

  /** Load a palace, then try to bring in its geometry (or ask the user to drop it). */
  private async adoptPalace(palace: Palace): Promise<void> {
    migratePalace(palace); // convert any old locus.child_palace to first-class portals
    this.palace = palace;
    this.root = palace;
    this.navStack = [];
    this.selectedId = null;
    this.viewer.applyEnvironment(this.palace.environment);
    const asset = palace.assets.find((a) => a.id === DEFAULT_ASSET_ID) ?? palace.assets[0];
    const file = asset?.file ?? '';

    // Auto-load embedded (data:) or fetchable (http/relative/bundled) assets. Only a
    // bare filename from an older, non-self-contained palace can't be resolved.
    this.editor.setNotice(null);
    if (/^(data:|https?:|\.?\/|assets\/)/.test(file)) {
      this.overlay.showLoading(file);
      try {
        await this.viewer.loadUrl(file);
      } catch {
        this.editor.setNotice(`World loaded. Now drag its geometry file ("${file}") onto the window to see the markers.`);
      }
    } else if (file) {
      this.editor.setNotice(`Palace "${palace.name}" loaded. Now drag its geometry file ("${file}") onto the window to see the markers.`);
    }
    this.loci.sync(this.palace);
    this.markDirty(); // autosave the loaded palace as the current draft
    this.history.reset(this.root); // loaded file is the new baseline
    this.savedClean = true; // matches the file on disk; nothing unsaved yet
    this.finishLoad();
  }

  /** Common tail after any load: return to the editor with a clean state. */
  private finishLoad(): void {
    if (this.viewer.fp.locked) this.viewer.fp.controls.unlock();
    this.setMode('edit');
  }
}

/** "mainfloor.glb" -> "mainfloor" for naming a new palace after its model. */
function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'Untitled palace';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/** Prompt for a single file via a transient <input>. Resolves null if cancelled-ish. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** A short label for toasts/logs from a prompt or cue. */
function snippet(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

new App();
