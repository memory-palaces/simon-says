import './style.css';
import * as THREE from 'three';
import { Viewer } from './engine/Viewer';
import { fileToDataUrl } from './engine/loadGlb';
import { LociLayer } from './engine/Loci';
import { Overlay } from './ui/overlay';
import { EditorPanel } from './ui/editorPanel';
import { ReviewOverlay } from './ui/review';
import { openPalace, readPalaceFile, savePalace } from './model/persistence';
import { listServerPalaces, loadServerPalace, saveServerPalace, serverInfo } from './model/server';
import { collectAssets, replaceAssetEverywhere, type AssetRef } from './model/assets';
import { openAssetManager } from './ui/assetManager';
import { loadDraft, saveDraft } from './model/autosave';
import { History } from './model/history';
import { GenerateDialog } from './ui/generateDialog';
import { SettingsDialog } from './ui/settingsDialog';
import { WelcomeDialog } from './ui/welcome';
import { Toasts } from './ui/toasts';
import { openGoToDialog, type GoToItem } from './ui/goToDialog';
import { MeshPreview } from './ui/meshPreview';
import { HelpOverlay } from './ui/help';
import { MapOverlay } from './ui/mapOverlay';
import { chooseAction } from './ui/choice';
import {
  buildPrompt,
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
  addDecor,
  addProp,
  addPropAttachment,
  createEmptyPalace,
  DEFAULT_ASSET_ID,
  DEFAULT_BACKGROUND,
  lociInOrder,
  migratePalace,
  removeDecor,
  removeLocus,
  removeProp,
  reorderLocus,
  setAsset,
  type Decor,
  type Locus,
  type Palace,
  type Portal,
  type Environment,
  type SceneProp,
  type Vec3,
} from './model/palace';

// Bundled zero-config sample so the app renders the instant it's cloned.
// The starter world: a bright little neighbourhood baked from Kenney's CC0 kits
// (scripts/street/build.mjs). Distinct, friendly landmarks are what loci stick to.
/** Bundled sample spaces offered by New. The first is the starter world. */
interface SampleSpace {
  id: string;
  url: string;
  label: string;
  sublabel: string;
  environment: Environment;
  /** Hand-picked starting spot (metres, matching the GLB); falls back to auto-recenter. */
  spawn?: { position: [number, number, number]; lookAt: [number, number, number] };
}
const SAMPLE_SPACES: SampleSpace[] = [
  {
    id: 'street', url: 'assets/samples/street/SimonsStreet.glb', label: "Simon's Street", sublabel: 'Bright neighbourhood — the starter world',
    environment: { background: '#dfeaf5', pattern: 'sky' },
    spawn: { position: [-8, 1.7, 0], lookAt: [30, 1.2, 0] }, // west end, looking down the street
  },
  {
    id: 'cave', url: 'assets/samples/cave/PlatosCave.glb', label: "Plato's Cave", sublabel: 'Cavern chambers, from the prisoners’ cell out to daylight',
    environment: { background: '#0f0a09', brightness: 1.6 },
    spawn: { position: [0, 1.7, -22], lookAt: [0, 1.5, 0] }, // in the cell, facing the bars
  },
  {
    id: 'forest', url: 'assets/samples/forest/ForestCamp.glb', label: 'Forest Camp', sublabel: 'A sunlit clearing: camp, archery range, lookout, bridge',
    environment: { background: '#dfeaf5', pattern: 'meadow' },
    spawn: { position: [0, 1.7, -18], lookAt: [0, 1.6, 10] }, // south edge, looking into the clearing
  },
  {
    id: 'dungeon', url: 'assets/samples/dungeon/Dungeon.glb', label: 'The Dungeon', sublabel: 'Undercroft: cell, treasury, great room and a stair down',
    environment: { background: '#0b0b10', brightness: 1.7 },
    spawn: { position: [0, 1.7, 22], lookAt: [0, 1.6, 0] }, // entrance hall, facing in
  },
  {
    id: 'virtualcity', url: 'assets/samples/virtualcity/VirtualCity.glb', label: 'Virtual City', sublabel: 'Sci-fi cityscape',
    environment: { background: DEFAULT_BACKGROUND },
  },
];

const DEFAULT_SPACE = { ...SAMPLE_SPACES[0], name: "Simon's Street (sample)" };

/** Duration of the bird's-eye zoom out / back (ms). */
const OVERVIEW_MS = 650;

type Mode = 'edit' | 'walk' | 'review';

class App {
  private readonly mount = document.getElementById('app')!;
  private readonly viewer = new Viewer(this.mount);
  private readonly loci = new LociLayer(this.viewer.scene, this.viewer.resolveAsset);
  private readonly overlay = new Overlay(this.mount);
  private readonly editor: EditorPanel;
  private readonly review = new ReviewOverlay(this.mount, {
    reveal: () => this.reviewReveal(),
    prev: () => this.reviewStep(-1),
    next: () => this.reviewStep(1),
    exit: () => this.endReview(),
  });
  private readonly toasts = new Toasts(this.mount);
  private readonly welcome = new WelcomeDialog(this.mount);
  private readonly generateDialog = new GenerateDialog(this.mount);
  private readonly meshPreview = new MeshPreview();
  private readonly helpOverlay = new HelpOverlay(this.mount);
  private readonly mapOverlay = new MapOverlay(this.mount, (path) => void this.jumpToWorld(path));
  private readonly settingsDialog = new SettingsDialog(this.mount, {
    setFalConfig: (apiKey, model) => this.setFalConfig(apiKey, model),
    setLocalConfig: (url, workflow) => this.setLocalConfig(url, workflow),
    testLocal: () => this.testLocal(),
    setPreamble: (text) => this.setPreamble(text),
  });

  private genSettings: GenerationSettings = loadGenerationSettings();
  /** Milliseconds for the go-to / recenter camera glide (0 = instant). */
  private gotoMs: number = this.genSettings.transitionMs ?? 350;
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
  private targetedDecorId: string | null = null;
  private movingId: string | null = null;
  /** Bird's-eye view: the pose we'll glide back to, and whether we're up there. */
  private overview: { pose: { position: THREE.Vector3; quaternion: THREE.Quaternion }; wasFlying: boolean } | null = null;
  /** A scene prop being placed/moved in-world by aiming at a surface. */
  private placingProp: { locusId: string; propId: string; savedOffset: Vec3 } | null = null;
  /** A free-standing decor item being placed/moved in-world by aiming. */
  private placingDecor: { decorId: string; saved: { position: Vec3; normal: Vec3 } } | null = null;

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
  /** Whether the local dev-server save/open API is reachable. */
  private serverOnline = false;
  /** Absolute path of the folder the server saves worlds into. */
  private serverDir: string | null = null;
  /** The server filename this palace is bound to, so Save overwrites it. */
  private serverName: string | null = null;

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
      save: () => this.saveSmart(),
      load: () => this.openSmart(),
      exportFile: () => this.save(true),
      importFile: () => this.loadViaPicker(),
      openAssets: () => this.openAssets(),
      newPalace: () => this.newPalace(),
      startReview: () => this.beginReview(),
      openSettings: () => this.settingsDialog.open(this.genConfig()),
      openGuide: () => this.welcome.open(),
      openLog: () => this.toasts.openLog(),
      recenter: () => this.recenterView(),
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
        this.loci.sync(this.palace); // the in-world plaque mirrors the text live
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
      setCaptions: (on) => this.setCaptions(on),
      toggleScaleFigure: () => this.toggleScaleFigure(),
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
      addPortalVisual: (id, kind) => this.addPortalVisual(id, kind),
      removePortalVisual: (id) => this.removePortalVisual(id),
      updatePortalPrompt: (id, prompt) => this.updatePortalPrompt(id, prompt),
      generatePortalImage: (id) => this.generatePortalImage(id),
      attachPortalImage: (id) => void this.attachPortal(id, 'image'),
      attachPortalMesh: (id) => void this.attachPortal(id, 'mesh'),
      setPortalScale: (id, v) => this.setPortalScale(id, v),
      setPortalRotation: (id, axis, v) => this.setPortalRotation(id, axis, v),
      makePortal3d: (id) => this.makePortal3d(id),
      addProp: (locusId, kind) => this.addProp(locusId, kind),
      removeProp: (locusId, propId) => this.removeProp(locusId, propId),
      updatePropText: (locusId, propId, text) => this.updatePropText(locusId, propId, text),
      updatePropPrompt: (locusId, propId, prompt) => this.updatePropPrompt(locusId, propId, prompt),
      generateProp: (locusId, propId) => this.generateProp(locusId, propId),
      attachPropImage: (locusId, propId) => void this.attachProp(locusId, propId, 'image'),
      attachPropMesh: (locusId, propId) => void this.attachProp(locusId, propId, 'mesh'),
      setPropOffset: (locusId, propId, axis, v) => this.setPropOffset(locusId, propId, axis, v),
      setPropScale: (locusId, propId, v) => this.setPropScale(locusId, propId, v),
      setPropRotation: (locusId, propId, axis, v) => this.setPropRotation(locusId, propId, axis, v),
      placeProp: (locusId, propId) => this.placeProp(locusId, propId),
      makeProp3d: (locusId, propId) => this.makeProp3d(locusId, propId),
      addDecor: (kind) => this.addDecor(kind),
      removeDecor: (id) => this.deleteDecor(id),
      updateDecorText: (id, text) => this.updateDecorText(id, text),
      updateDecorPrompt: (id, prompt) => this.updateDecorPrompt(id, prompt),
      generateDecor: (id) => this.generateDecor(id),
      attachDecorImage: (id) => void this.attachDecor(id, 'image'),
      attachDecorMesh: (id) => void this.attachDecor(id, 'mesh'),
      setDecorScale: (id, v) => this.setDecorScale(id, v),
      setDecorRotation: (id, axis, v) => this.setDecorRotation(id, axis, v),
      placeDecor: (id) => this.placeDecor(id),
      makeDecor3d: (id) => this.makeDecor3d(id),
    });
    this.syncGeneration();

    this.toasts.setTunables([
      { id: 'marker', label: 'Marker size', min: 0.3, max: 3, step: 0.1, value: 1, onChange: (v) => { this.loci.setMarkerScale(v); this.loci.sync(this.palace); } },
      { id: 'glow', label: 'Mesh glow', min: 0, max: 1, step: 0.05, value: 0.45, onChange: (v) => this.loci.setMeshEmissive(v) },
      { id: 'fade', label: 'Fade ms', min: 0, max: 600, step: 20, value: this.fadeMs, onChange: (v) => (this.fadeMs = v) },
      {
        id: 'goto',
        label: 'Go-to ms',
        min: 0,
        max: 1500,
        step: 50,
        value: this.gotoMs,
        onChange: (v) => {
          this.gotoMs = v;
          this.genSettings = { ...this.genSettings, transitionMs: v };
          saveGenerationSettings(this.genSettings);
        },
      },
    ]);

    this.viewer.start();
    this.viewer.onFrame(() => this.onFrame());
    this.wireEvents();
    void this.boot().finally(() => {
      if (WelcomeDialog.wantedOnStartup()) this.welcome.open();
    });
  }

  private async boot(): Promise<void> {
    // Detect the local save/open server (present when run via the dev server) so
    // Save/Open write straight to disk instead of downloading a file each time.
    void serverInfo().then(({ online, dir }) => {
      this.serverOnline = online;
      this.serverDir = dir;
      this.editor.setServerInfo(online, dir);
      if (this.mode === 'edit') this.renderEditor();
    });

    // Restore an autosaved draft if one exists — never make the user start over
    // because of a refresh or crash.
    const draft = await loadDraft();
    // Exception: an untouched draft of a *bundled sample* (no loci, portals or decor,
    // and the model is one of ours) is just "the app was opened once" — skip it so
    // people always get the current starter world, not whichever sample shipped when
    // they first visited.
    const untouchedSample =
      !!draft &&
      draft.loci.length === 0 &&
      (draft.portals?.length ?? 0) === 0 &&
      (draft.decor?.length ?? 0) === 0 &&
      draft.assets.every((a) => a.file.startsWith('assets/samples/'));
    if (draft && !untouchedSample) {
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
      this.palace.environment = { ...this.palace.environment, ...DEFAULT_SPACE.environment };
      this.viewer.applyEnvironment(this.palace.environment);
      this.loci.sync(this.palace);
      this.history.reset(this.root);
      this.setMode('edit');
      if (this.viewer.hasModel) this.spawnInSample(DEFAULT_SPACE);
    } catch (err) {
      console.error(err);
      this.overlay.showError(
        `Couldn't load the sample space. If you opened the file directly, run a local server (see README). ` +
          `You can still drag your own .glb onto the window.`,
      );
    }
  }

  /** Stand at a sample world's hand-picked spawn, or auto-frame it if it has none. */
  private spawnInSample(sample: SampleSpace): void {
    const sp = sample.spawn;
    if (!sp) {
      this.recenterView(false, true);
      return;
    }
    this.viewer.flyTo(new THREE.Vector3(...sp.position), new THREE.Vector3(...sp.lookAt), 0);
    this.viewer.fp.setFlying(false); // stand on the floor
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
  /** Primary Save: to the local server when it's running, else to a file. */
  private async saveSmart(): Promise<void> {
    if (this.serverOnline) return this.saveToServer();
    return this.save();
  }

  /** Primary Open: from the local server when it's running, else a file picker. */
  private async openSmart(): Promise<void> {
    if (this.serverOnline) return this.openFromServer();
    return this.loadViaPicker();
  }

  private async saveToServer(): Promise<void> {
    const name = this.serverName ?? sanitizeName(this.root.name);
    try {
      await saveServerPalace(name, this.root);
      this.serverName = name;
      this.savedClean = true;
      const where = this.serverDir ? `${this.serverDir}/${name}.json` : `${name}.json`;
      this.toasts.success(`Saved to ${where}`);
    } catch (err) {
      console.error(err);
      this.toasts.error('Could not save to localhost.');
    }
  }

  private async openFromServer(): Promise<void> {
    if (!(await this.confirmDiscard('Open a saved world?'))) return;
    let items;
    try {
      items = await listServerPalaces();
    } catch (err) {
      console.error(err);
      this.toasts.error('Could not reach localhost.');
      return;
    }
    if (items.length === 0) {
      this.toasts.info('No worlds saved on localhost yet — use Save first.');
      return;
    }
    items.sort((a, b) => b.mtime - a.mtime);
    const choice = await chooseAction(this.mount, {
      title: 'Open from localhost',
      message: 'Worlds saved on this computer:',
      choices: [
        ...items.map((it) => ({ id: it.name, label: it.name, sublabel: `${relTime(it.mtime)} · ${Math.round(it.size / 1024)} KB` })),
        { id: '__cancel', label: 'Cancel' },
      ],
    });
    if (!choice || choice === '__cancel') return;
    try {
      const palace = await loadServerPalace(choice);
      this.fileHandle = null;
      this.serverName = choice;
      await this.adoptPalace(palace);
      this.toasts.success(`Opened “${palace.name}”`);
    } catch (err) {
      console.error(err);
      this.toasts.error('Could not open that world.');
    }
  }

  /** Explicit file export (Save As / download), independent of the server. */
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
        { id: 'save', label: 'Save, then continue', sublabel: this.serverOnline ? 'Saves to localhost first' : 'Exports a .json first', variant: 'primary' },
        { id: 'discard', label: 'Continue without saving' },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    if (choice === null || choice === 'cancel') return false;
    if (choice === 'save') await this.saveSmart();
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
    this.targetedDecorId = null;
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
    const portals = this.palace.portals ?? [];
    if (this.palace.loci.length === 0 && portals.length === 0) {
      this.toasts.info('No loci or portals to go to yet.');
      return;
    }
    // Release the pointer so the user can type into the palette.
    if (this.viewer.fp.locked) this.viewer.fp.controls.unlock();
    const items: GoToItem[] = [
      ...lociInOrder(this.palace).map((l) => ({ id: l.id, order: l.order, label: l.label, kind: 'locus' as const })),
      ...portals.map((p) => ({
        id: p.id,
        order: -1,
        label: `${p.label || '(unnamed portal)'} ↗ ${p.target?.name ?? 'empty'}`,
        kind: 'portal' as const,
      })),
    ];
    openGoToDialog(this.mount, items, (id) => {
      // Fly in so you don't immediately drop off an upper floor.
      this.viewer.fp.setFlying(true);
      this.enterWalk();
      if (portals.some((p) => p.id === id)) {
        this.gotoPortal(id);
        const p = portals.find((x) => x.id === id);
        this.toasts.info(`Jumped to portal${p?.label ? ` — ${p.label}` : ''}`);
        return;
      }
      this.gotoLocus(id);
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

  /** Keyboard dolly (}/{) — step the camera forward/back along the view direction. */
  private dolly(dir: 1 | -1): void {
    this.viewer.camera.getWorldDirection(this.scratchA);
    const step = dir * 0.7 * Math.max(0.3, this.viewer.fp.eyeOffset / 1.7);
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
      if (this.overview) this.exitOverview(); // Esc leaves the bird's-eye view first
      if (this.placingProp) this.cancelPropPlacement(); // Esc/right-click aborts a prop placement
      if (this.placingDecor) this.cancelDecorPlacement();
      if (this.mode === 'walk') this.setMode('edit');
    });

    const canvas = this.viewer.renderer.domElement;
    // Click the 3D view to start walking; while walking, click a marker you're
    // looking at — a doorway pin enters its inner palace, otherwise open its editor.
    canvas.addEventListener('click', (e) => {
      // In bird's-eye view a click is "take me there", not "start walking".
      if (this.overview) {
        const hit = this.viewer.raycastScreen(e.clientX, e.clientY);
        this.exitOverview(hit?.point);
        return;
      }
      if (this.mode === 'edit') this.enterWalk();
      else if (this.placingProp) this.finishPropPlacement();
      else if (this.placingDecor) this.finishDecorPlacement();
      else if (this.mode === 'walk' && !this.movingId && (this.targetedId || this.targetedPortalId)) this.clickTargeted();
    });
    // While in bird's-eye view, track the spot under the cursor so you can see
    // exactly where a click would drop you.
    canvas.addEventListener('mousemove', (e) => {
      if (!this.overview) return;
      const hit = this.viewer.raycastScreen(e.clientX, e.clientY);
      if (hit) this.viewer.showPickMarker(hit.point, hit.normal);
      else this.viewer.hidePickMarker();
    });
    canvas.addEventListener('mouseleave', () => {
      if (this.overview) this.viewer.hidePickMarker();
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
      if (this.placingProp && hit) {
        // Grabbed prop follows the crosshair, offset relative to its parent locus.
        const found = this.findProp(this.placingProp.locusId, this.placingProp.propId);
        const offset = this.loci.offsetFromWorld(this.placingProp.locusId, hit.point);
        if (found && offset) {
          offset[2] += 0.3; // sit just off the surface so it doesn't clip into the wall
          found.prop.offset = offset;
          this.loci.sync(this.palace);
        }
      } else if (this.placingDecor && hit) {
        // Free-standing decor follows the crosshair, anchored in asset-local space.
        const d = this.findDecor(this.placingDecor.decorId);
        if (d) {
          const local = this.loci.worldToLocal(d.asset_id, hit.point, hit.normal);
          d.local_position = local.position;
          d.local_normal = local.normal;
          this.loci.sync(this.palace);
        }
      } else if (this.movingId && hit) {
        // Grabbed locus follows the crosshair across the surface.
        const local = this.loci.worldToLocal(DEFAULT_ASSET_ID, hit.point, hit.normal);
        this.mutateLocus(this.movingId, (l) => {
          l.local_position = local.position;
          l.local_normal = local.normal;
        }, false);
        this.loci.sync(this.palace);
      } else {
        // Highlight whatever the crosshair is over — a portal takes priority, then a
        // locus, then free-standing decor.
        const ray = this.crosshairRay();
        const portalId = this.loci.pickPortal(ray);
        const locusId = portalId ? null : this.loci.pick(ray);
        const decorId = portalId || locusId ? null : this.loci.pickDecor(ray);
        if (portalId !== this.targetedPortalId || locusId !== this.targetedId || decorId !== this.targetedDecorId) {
          this.targetedPortalId = portalId;
          this.targetedId = locusId;
          this.targetedDecorId = decorId;
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
    if (this.targetedDecorId) {
      const d = this.findDecor(this.targetedDecorId);
      const what = escapeHtml(d?.text || d?.image_prompt || 'Decor');
      this.overlay.setTooltip(`<div class="tt-title">Decor</div><div class="tt-door">${what} — [G] move</div>`);
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
    if (this.placingProp || this.placingDecor) parts.push('placing — [G]/click to drop · Esc cancels');
    else if (this.movingId) parts.push('moving — [G]/[T] drop');
    else if (this.targetedPortalId) parts.push('portal — [Enter] go through');
    else if (this.targetedDecorId) parts.push('decor — [G] move');
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
    // While the guide is up, Esc closes it and nothing else reacts.
    if (this.welcome.isOpen()) {
      if (e.code === 'Escape') this.welcome.hide();
      return;
    }
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

    // 'V' toggles the bird's-eye view of the whole world.
    const vt = e.target as HTMLElement | null;
    const vTyping = !!vt && (vt.tagName === 'INPUT' || vt.tagName === 'TEXTAREA');
    if (!vTyping && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      this.toggleOverview();
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
    // { / } dolly the camera out / in — a keyboard zoom to frame a locus after
    // flying to it (mirrors the mouse wheel, works whether or not the pointer is
    // locked). Shift+[ = '{', Shift+] = '}'.
    if (!typing && (e.key === '{' || e.key === '}')) {
      e.preventDefault();
      this.dolly(e.key === '}' ? 1 : -1);
      return;
    }

    if (this.mode === 'walk') {
      if (e.code === 'KeyT') this.dropOrPlace();
      else if (e.code === 'KeyB') this.deleteTargeted();
      else if (e.code === 'KeyG') this.genericMove();
      else if (e.code === 'KeyR') this.recenterView();
      else if (e.code === 'KeyX') this.toggleXray();
      else if (e.code === 'KeyP') this.placePortal();
      else if (e.code === 'Enter' && this.targetedPortalId) void this.enterPortal(this.targetedPortalId);
      else if (e.code === 'KeyQ') void this.returnToParent(); // Q, not Backspace (avoids browser-back)
    } else if (this.mode === 'review') {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        this.reviewAdvance();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.reviewStep(1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.reviewStep(-1);
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

  /** G is the generic "grab & move": drop what's held, else grab what's aimed at. */
  private genericMove(): void {
    if (this.placingDecor) return this.finishDecorPlacement();
    if (this.placingProp) return this.finishPropPlacement();
    if (this.movingId) return this.toggleMove(); // drop the held locus
    if (this.targetedId) return this.toggleMove(); // grab the aimed-at locus
    if (this.targetedDecorId) return this.beginDecorMove(this.targetedDecorId);
  }

  /** Grab a decor item at the crosshair; it then follows until G/click drops it. */
  private beginDecorMove(id: string): void {
    const d = this.findDecor(id);
    if (!d) return;
    this.placingDecor = {
      decorId: id,
      saved: { position: [...d.local_position] as Vec3, normal: [...d.local_normal] as Vec3 },
    };
    this.toasts.info('Moving decor — aim, then G or click to drop. Esc cancels.');
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
    this.viewer.setScaleFigureScale(value);
    this.markDirty();
    this.checkpointSoon();
  }

  private setCaptions(on: boolean): void {
    this.palace.environment = { ...(this.palace.environment ?? { background: DEFAULT_BACKGROUND }), captions: on };
    this.loci.sync(this.palace);
    this.markDirty();
    this.checkpointSoon();
  }

  /**
   * Bird's-eye view (V): glide up to a top-down shot of the whole world, then back
   * to exactly where you were. Physics is untouched — we just fly the camera and
   * park movement while you're up there (a click drops you at the spot you picked).
   */
  private toggleOverview(): void {
    if (this.overview) {
      this.exitOverview();
      return;
    }
    // The editor panel covers the right of the canvas in edit mode; frame the world
    // in what's actually visible.
    const panel = this.mode === 'edit' ? document.querySelector('.editor') : null;
    const covered = panel ? panel.getBoundingClientRect().width : 0;
    const pose = this.viewer.overviewPose(covered);
    if (!pose) {
      this.toasts.info('Load a model first.');
      return;
    }
    this.overview = { pose: this.viewer.cameraPose(), wasFlying: this.viewer.fp.mode === 'fly' };
    this.viewer.fp.setFlying(true); // no gravity while we're above the world
    this.viewer.flyTo(pose.position, pose.lookAt, OVERVIEW_MS);
    this.overlay.setCrosshair(false); // the pointer is free up here; we mark the
    this.viewer.renderer.domElement.classList.add('picking'); // spot under the cursor
    this.overlay.setHud('Bird’s-eye view — click to go there · V to return');
  }

  /** Return to where we were before the overview (or to `to`, if a spot was clicked). */
  private exitOverview(to?: THREE.Vector3): void {
    const state = this.overview;
    if (!state) return;
    this.overview = null;
    if (to) {
      const eye = to.clone().setY(to.y + this.viewer.fp.eyeOffset);
      // Look the way we were facing before, from the new spot.
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(state.pose.quaternion);
      forward.y = 0;
      if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
      this.viewer.flyTo(eye, eye.clone().add(forward.normalize()), OVERVIEW_MS);
      window.setTimeout(() => this.viewer.fp.setFlying(false), OVERVIEW_MS + 30); // land on the floor
    } else {
      this.viewer.flyToPose(state.pose, OVERVIEW_MS);
      if (!state.wasFlying) window.setTimeout(() => this.viewer.fp.setFlying(false), OVERVIEW_MS + 30);
    }
    this.viewer.renderer.domElement.classList.remove('picking');
    this.viewer.hidePickMarker();
    this.overlay.setCrosshair(this.mode === 'walk');
    this.overlay.setHud('');
  }

  private toggleScaleFigure(): void {
    if (!this.viewer.hasModel) {
      this.toasts.info('Load a model first to preview scale.');
      return;
    }
    // The preview moves the camera, so release the pointer if it's captured.
    if (this.viewer.fp.locked) this.viewer.fp.controls.unlock();
    const on = this.viewer.toggleScaleFigure(this.palace.environment?.playerScale ?? 1);
    this.toasts.info(
      on
        ? 'Scale preview — drag Player scale to compare a person to the building; click 🚶 again to return'
        : 'Returned from scale preview',
    );
  }

  // --- Generation ------------------------------------------------------------

  private backendOptions(): Array<{ id: string; label: string }> {
    return [{ id: NONE_ID, label: 'None (text only)' }, ...listBackends().map((b) => ({ id: b.id, label: b.label }))];
  }

  private genConfig(): { local?: LocalConfig; fal?: FalConfig; preamble?: string } {
    return { local: this.genSettings.local, fal: this.genSettings.fal, preamble: this.genSettings.preamble };
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

  /** Store the rendering preamble. `undefined` means "use the built-in default". */
  private setPreamble(text: string | undefined): void {
    this.genSettings = { ...this.genSettings, preamble: text };
    if (text === undefined) delete this.genSettings.preamble;
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
    const locus = this.palace.loci.find((l) => l.id === id);
    if (!locus) return;
    this.openImageGen({
      prompt: locus.image_prompt,
      historyKey: id,
      current: locus.image_2d,
      onApprove: (dataUrl) => {
        // A newly approved image becomes the representation; the old mesh (now stale
        // for this image) stays in the gallery so you can rotate back to it.
        locus.image_2d = dataUrl;
        locus.mesh_3d = null;
        addAttachment(locus, { type: 'image', src: dataUrl });
      },
    });
  }

  /**
   * Shared Render dialog for anything that holds an image (a locus or a scene
   * prop). Falls back to the offline placeholder if this world has no pipeline
   * chosen, so Render always does something. The mnemonic text is never altered.
   */
  private openImageGen(opts: { prompt: string; historyKey: string; current: string | null; onApprove: (dataUrl: string) => void }): void {
    const backend = getBackend(this.activeBackendId()) ?? getBackend('placeholder');
    if (!backend) return;
    if (!opts.prompt.trim()) return;
    let history = this.sessionImages.get(opts.historyKey);
    if (!history) {
      history = opts.current ? [opts.current] : [];
      this.sessionImages.set(opts.historyKey, history);
    }
    const styledPrompt = buildPrompt(opts.prompt, this.palace.generation?.style);
    this.generateDialog.open(opts.prompt, {
      variants: history,
      generate: (seed) => backend.generateImage(styledPrompt, seed),
      onGenerated: (dataUrl) => history!.push(dataUrl),
      onApprove: (dataUrl) => {
        opts.onApprove(dataUrl);
        this.loci.sync(this.palace);
        this.checkpoint();
        this.renderEditor();
      },
    });
  }

  // --- Scene props -----------------------------------------------------------

  private findProp(locusId: string, propId: string): { locus: Locus; prop: SceneProp } | null {
    const locus = this.palace.loci.find((l) => l.id === locusId);
    const prop = locus?.props?.find((p) => p.id === propId);
    return locus && prop ? { locus, prop } : null;
  }

  private addProp(locusId: string, kind: 'text' | 'image' | 'mesh'): void {
    const locus = this.palace.loci.find((l) => l.id === locusId);
    if (!locus) return;
    addProp(locus, kind);
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  private removeProp(locusId: string, propId: string): void {
    const locus = this.palace.loci.find((l) => l.id === locusId);
    if (!locus) return;
    removeProp(locus, propId);
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  private updatePropText(locusId: string, propId: string, text: string): void {
    const found = this.findProp(locusId, propId);
    if (!found) return;
    found.prop.text = text;
    this.loci.sync(this.palace); // no re-render: keep focus in the field
    this.checkpointSoon();
  }

  private updatePropPrompt(locusId: string, propId: string, prompt: string): void {
    const found = this.findProp(locusId, propId);
    if (!found) return;
    found.prop.image_prompt = prompt;
    this.checkpointSoon(); // no re-render: keep focus in the field
  }

  private generateProp(locusId: string, propId: string): void {
    const found = this.findProp(locusId, propId);
    if (!found) return;
    this.openImageGen({
      prompt: found.prop.image_prompt ?? '',
      historyKey: `${locusId}:${propId}`,
      current: found.prop.src ?? null,
      onApprove: (dataUrl) => {
        found.prop.src = dataUrl;
        addPropAttachment(found.prop, { type: 'image', src: dataUrl });
      },
    });
  }

  private async attachProp(locusId: string, propId: string, kind: 'image' | 'mesh'): Promise<void> {
    const file = await pickFile(kind === 'image' ? 'image/*' : '.glb,.gltf,model/gltf-binary');
    if (!file) return;
    const found = this.findProp(locusId, propId);
    if (!found) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      found.prop.src = dataUrl;
      addPropAttachment(found.prop, { type: kind, src: dataUrl });
      this.loci.sync(this.palace);
      this.checkpoint();
      this.renderEditor();
      this.toasts.success(kind === 'image' ? 'Image attached to prop' : '3D model attached to prop');
    } catch (err) {
      console.error(err);
      this.toasts.error(`Couldn't attach "${file.name}"`);
    }
  }

  private setPropOffset(locusId: string, propId: string, axis: number, value: number): void {
    const found = this.findProp(locusId, propId);
    if (!found) return;
    const o: Vec3 = found.prop.offset ?? [0, 0, 0];
    o[axis] = value;
    found.prop.offset = o;
    this.loci.sync(this.palace);
    this.checkpointSoon();
  }

  private setPropScale(locusId: string, propId: string, value: number): void {
    const found = this.findProp(locusId, propId);
    if (!found) return;
    found.prop.scale = value;
    this.loci.sync(this.palace);
    this.checkpointSoon();
  }

  private setPropRotation(locusId: string, propId: string, axis: number, value: number): void {
    const found = this.findProp(locusId, propId);
    if (!found) return;
    const r: Vec3 = found.prop.rotation ?? [0, 0, 0];
    r[axis] = value;
    found.prop.rotation = r;
    this.loci.sync(this.palace);
    this.checkpointSoon();
  }

  /** Arm in-world placement: aim at a surface and click to drop the prop there. */
  private placeProp(locusId: string, propId: string): void {
    const found = this.findProp(locusId, propId);
    if (!found) return;
    this.selectedId = locusId;
    this.loci.setSelected(locusId);
    this.placingProp = { locusId, propId, savedOffset: [...(found.prop.offset ?? [0, 0, 0])] as Vec3 };
    this.viewer.fp.setFlying(true);
    this.enterWalk(); // locks the pointer so you can aim
    this.toasts.info('Placing prop — aim at a surface and click to drop. Esc cancels.');
  }

  private finishPropPlacement(): void {
    if (!this.placingProp) return;
    this.placingProp = null;
    this.checkpoint(); // commit the new offset to history
    this.toasts.success('Prop placed');
  }

  private cancelPropPlacement(): void {
    if (!this.placingProp) return;
    const found = this.findProp(this.placingProp.locusId, this.placingProp.propId);
    if (found) found.prop.offset = this.placingProp.savedOffset; // restore where it was
    this.placingProp = null;
    this.loci.sync(this.palace);
  }

  /** Turn an image prop into a 3D prop (image -> mesh), reusing the world pipeline. */
  private makeProp3d(locusId: string, propId: string): void {
    const found = this.findProp(locusId, propId);
    if (!found || !found.prop.src) return;
    const label = snippet(found.prop.image_prompt || `prop ${found.prop.id}`);
    void this.imageTo3d(found.prop.src, label, (glb) => {
      found.prop.kind = 'mesh';
      found.prop.src = glb;
      found.prop.rotation = found.prop.rotation ?? [0, 0, 0];
      addPropAttachment(found.prop, { type: 'mesh', src: glb });
    });
  }

  // --- Free-standing decor ---------------------------------------------------

  private findDecor(id: string): Decor | undefined {
    return this.palace.decor?.find((d) => d.id === id);
  }

  /** Asset-local anchor where you're looking (or a few metres ahead), for seeding decor. */
  private viewSeedLocal(): { position: Vec3; normal: Vec3 } {
    const hit = this.viewer.raycastSurface();
    let point: THREE.Vector3;
    let normal: THREE.Vector3;
    if (hit) {
      point = hit.point;
      normal = hit.normal;
    } else {
      this.viewer.camera.getWorldDirection(this.scratchA);
      point = this.viewer.camera.position.clone().addScaledVector(this.scratchA, 3);
      normal = this.scratchA.clone().multiplyScalar(-1);
    }
    return this.loci.worldToLocal(DEFAULT_ASSET_ID, point, normal);
  }

  private addDecor(kind: 'text' | 'image' | 'mesh'): void {
    const seed = this.viewSeedLocal();
    addDecor(this.palace, kind, seed.position, seed.normal);
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
    this.toasts.info('Decor added — use 📍 to place it in the world.');
  }

  private deleteDecor(id: string): void {
    removeDecor(this.palace, id);
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  private updateDecorText(id: string, text: string): void {
    const d = this.findDecor(id);
    if (!d) return;
    d.text = text;
    this.loci.sync(this.palace); // no re-render: keep focus in the field
    this.checkpointSoon();
  }

  private updateDecorPrompt(id: string, prompt: string): void {
    const d = this.findDecor(id);
    if (!d) return;
    d.image_prompt = prompt;
    this.checkpointSoon();
  }

  private generateDecor(id: string): void {
    const d = this.findDecor(id);
    if (!d) return;
    this.openImageGen({
      prompt: d.image_prompt ?? '',
      historyKey: `decor:${id}`,
      current: d.src ?? null,
      onApprove: (dataUrl) => {
        d.src = dataUrl;
        addPropAttachment(d, { type: 'image', src: dataUrl });
      },
    });
  }

  private async attachDecor(id: string, kind: 'image' | 'mesh'): Promise<void> {
    const file = await pickFile(kind === 'image' ? 'image/*' : '.glb,.gltf,model/gltf-binary');
    if (!file) return;
    const d = this.findDecor(id);
    if (!d) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      d.src = dataUrl;
      addPropAttachment(d, { type: kind, src: dataUrl });
      this.loci.sync(this.palace);
      this.checkpoint();
      this.renderEditor();
      this.toasts.success(kind === 'image' ? 'Image attached to decor' : '3D model attached to decor');
    } catch (err) {
      console.error(err);
      this.toasts.error(`Couldn't attach "${file.name}"`);
    }
  }

  private setDecorScale(id: string, value: number): void {
    const d = this.findDecor(id);
    if (!d) return;
    d.scale = value;
    this.loci.sync(this.palace);
    this.checkpointSoon();
  }

  private setDecorRotation(id: string, axis: number, value: number): void {
    const d = this.findDecor(id);
    if (!d) return;
    const r: Vec3 = d.rotation ?? [0, 0, 0];
    r[axis] = value;
    d.rotation = r;
    this.loci.sync(this.palace);
    this.checkpointSoon();
  }

  private placeDecor(id: string): void {
    const d = this.findDecor(id);
    if (!d) return;
    this.placingDecor = {
      decorId: id,
      saved: { position: [...d.local_position] as Vec3, normal: [...d.local_normal] as Vec3 },
    };
    this.viewer.fp.setFlying(true);
    this.enterWalk();
    this.toasts.info('Placing decor — aim at a surface and click to drop. Esc cancels.');
  }

  private finishDecorPlacement(): void {
    if (!this.placingDecor) return;
    this.placingDecor = null;
    this.checkpoint();
    this.toasts.success('Decor placed');
  }

  private cancelDecorPlacement(): void {
    if (!this.placingDecor) return;
    const d = this.findDecor(this.placingDecor.decorId);
    if (d) {
      d.local_position = this.placingDecor.saved.position;
      d.local_normal = this.placingDecor.saved.normal;
    }
    this.placingDecor = null;
    this.loci.sync(this.palace);
  }

  private makeDecor3d(id: string): void {
    const d = this.findDecor(id);
    if (!d?.src) return;
    const label = snippet(d.image_prompt || `decor ${d.id}`);
    void this.imageTo3d(d.src, label, (glb) => {
      d.kind = 'mesh';
      d.src = glb;
      d.rotation = d.rotation ?? [0, 0, 0];
      addPropAttachment(d, { type: 'mesh', src: glb });
    });
  }

  // --- Portal visuals --------------------------------------------------------

  private findPortal(id: string): Portal | undefined {
    return this.palace.portals?.find((p) => p.id === id);
  }

  private addPortalVisual(id: string, kind: 'image' | 'mesh'): void {
    const p = this.findPortal(id);
    if (!p) return;
    p.kind = kind;
    p.image_prompt = p.image_prompt ?? '';
    p.scale = p.scale ?? 1;
    if (kind === 'mesh') p.rotation = p.rotation ?? [0, 0, 0];
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  private removePortalVisual(id: string): void {
    const p = this.findPortal(id);
    if (!p) return;
    p.kind = undefined;
    p.src = null;
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
  }

  private updatePortalPrompt(id: string, prompt: string): void {
    const p = this.findPortal(id);
    if (!p) return;
    p.image_prompt = prompt;
    this.checkpointSoon();
  }

  private generatePortalImage(id: string): void {
    const p = this.findPortal(id);
    if (!p) return;
    this.openImageGen({
      prompt: p.image_prompt ?? '',
      historyKey: `portal:${id}`,
      current: p.src ?? null,
      onApprove: (dataUrl) => {
        p.kind = 'image';
        p.src = dataUrl;
        addPropAttachment(p, { type: 'image', src: dataUrl });
      },
    });
  }

  private async attachPortal(id: string, kind: 'image' | 'mesh'): Promise<void> {
    const file = await pickFile(kind === 'image' ? 'image/*' : '.glb,.gltf,model/gltf-binary');
    if (!file) return;
    const p = this.findPortal(id);
    if (!p) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      p.kind = kind;
      p.src = dataUrl;
      addPropAttachment(p, { type: kind, src: dataUrl });
      this.loci.sync(this.palace);
      this.checkpoint();
      this.renderEditor();
      this.toasts.success(kind === 'image' ? 'Image attached to portal' : '3D model attached to portal');
    } catch (err) {
      console.error(err);
      this.toasts.error(`Couldn't attach "${file.name}"`);
    }
  }

  private setPortalScale(id: string, value: number): void {
    const p = this.findPortal(id);
    if (!p) return;
    p.scale = value;
    this.loci.sync(this.palace);
    this.checkpointSoon();
  }

  private setPortalRotation(id: string, axis: number, value: number): void {
    const p = this.findPortal(id);
    if (!p) return;
    const r: Vec3 = p.rotation ?? [0, 0, 0];
    r[axis] = value;
    p.rotation = r;
    this.loci.sync(this.palace);
    this.checkpointSoon();
  }

  private makePortal3d(id: string): void {
    const p = this.findPortal(id);
    if (!p?.src) return;
    const label = snippet(p.image_prompt || p.label || `portal ${p.id}`);
    void this.imageTo3d(p.src, label, (glb) => {
      p.kind = 'mesh';
      p.src = glb;
      p.rotation = p.rotation ?? [0, 0, 0];
      addPropAttachment(p, { type: 'mesh', src: glb });
    });
  }

  // --- Assets library --------------------------------------------------------

  private openAssets(): void {
    const items = collectAssets(this.palace);
    if (items.length === 0) {
      this.toasts.info('No images or 3D models yet — render or attach some first.');
      return;
    }
    if (this.viewer.fp.locked) this.viewer.fp.controls.unlock();
    openAssetManager(this.mount, items, {
      onAttach: (a) => void this.attachAssetTo(a),
      onReplace: (a) => void this.replaceAssetFlow(a),
      mountMeshPreview: (c, src) => this.meshPreview.attach(c, src),
    });
  }

  /** Swap an asset for another (existing) one everywhere it's used. */
  private async replaceAssetFlow(a: AssetRef): Promise<void> {
    const others = collectAssets(this.palace).filter((x) => x.src !== a.src);
    if (others.length === 0) {
      this.toasts.info('No other asset to replace it with — make or upload another first.');
      return;
    }
    const choice = await chooseAction(this.mount, {
      title: `Replace this ${a.type} everywhere (${a.uses}×)`,
      message: 'Pick the asset to use instead — every place using the old one switches to it:',
      choices: [
        ...others.map((o) => ({ id: o.src, label: `${o.type === 'mesh' ? '◈ 3D' : '▦ Image'} — ${o.label}`, sublabel: `used ${o.uses}×` })),
        { id: '__cancel', label: 'Cancel' },
      ],
    });
    if (!choice || choice === '__cancel') return;
    const replacement = others.find((o) => o.src === choice);
    if (!replacement) return;
    const n = replaceAssetEverywhere(this.palace, a.src, replacement.src, replacement.type);
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
    this.toasts.success(`Replaced in ${n} ${n === 1 ? 'place' : 'places'}.`);
  }

  /** Reuse an existing asset by attaching it to another element. */
  private async attachAssetTo(a: AssetRef): Promise<void> {
    const choice = await chooseAction(this.mount, {
      title: 'Attach asset to…',
      message: 'Reuse this asset on another element (a copy is placed — the original stays put):',
      choices: [
        { id: 'decor', label: 'New decor', sublabel: 'ambiance, placed anywhere' },
        ...lociInOrder(this.palace).map((l) => ({
          id: `locus:${l.id}`,
          label: `Locus ${l.order}${l.label ? ` — ${l.label}` : ''}`,
          sublabel: 'add as a scene prop',
        })),
        ...(this.palace.portals ?? []).map((p) => ({
          id: `portal:${p.id}`,
          label: `Portal ${p.label || '(unnamed)'}`,
          sublabel: 'use as its doorway visual',
        })),
        { id: '__cancel', label: 'Cancel' },
      ],
    });
    if (!choice || choice === '__cancel') return;

    if (choice === 'decor') {
      const seed = this.viewSeedLocal();
      const d = addDecor(this.palace, a.type, seed.position, seed.normal);
      d.src = a.src;
      addPropAttachment(d, { type: a.type, src: a.src });
      this.toasts.success('Added as decor — use 📍 to place it.');
    } else if (choice.startsWith('locus:')) {
      const locus = this.palace.loci.find((l) => l.id === choice.slice('locus:'.length));
      if (locus) {
        const p = addProp(locus, a.type);
        p.src = a.src;
        addPropAttachment(p, { type: a.type, src: a.src });
        this.toasts.success(`Added as a prop on Locus ${locus.order}.`);
      }
    } else if (choice.startsWith('portal:')) {
      const p = this.findPortal(choice.slice('portal:'.length));
      if (p) {
        p.kind = a.type;
        p.src = a.src;
        addPropAttachment(p, { type: a.type, src: a.src });
        this.toasts.success('Set as the portal visual.');
      }
    }
    this.loci.sync(this.palace);
    this.checkpoint();
    this.renderEditor();
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
    const locus = this.palace.loci.find((l) => l.id === id);
    if (!locus?.image_2d) return;
    const label = snippet(locus.image_prompt || locus.label || `locus ${locus.order}`);
    await this.imageTo3d(locus.image_2d, label, (glb) => {
      locus.mesh_3d = glb;
      addAttachment(locus, { type: 'mesh', src: glb });
    });
  }

  /**
   * Shared image->3D: run the world pipeline's imageTo3d, with a floating toast
   * that resolves in place (multiple jobs can run at once). No-ops if the pipeline
   * can't do 3D. `onGlb` applies the result to whatever holds it (locus or prop).
   */
  private async imageTo3d(image: string, label: string, onGlb: (glb: string) => void): Promise<void> {
    const backend = getBackend(this.activeBackendId());
    if (!backend?.imageTo3d) return;
    const toast = this.toasts.show(`Rendering 3D — ${label}…`, 'info', { sticky: true });
    try {
      const glb = await backend.imageTo3d(image);
      onGlb(glb);
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
    // Which space should the fresh world use? Keeping the current model lets you
    // restart your loci in the same place; the samples give you a clean start.
    const choice = await chooseAction(this.mount, {
      title: 'New world',
      message: 'Which space do you want to start in?',
      choices: [
        { id: 'keep', label: 'Keep this space', sublabel: 'Same model, fresh empty route', variant: 'primary' },
        ...SAMPLE_SPACES.map((s) => ({ id: s.id, label: s.label, sublabel: s.sublabel })),
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    if (choice === null || choice === 'cancel') return;
    const sample = SAMPLE_SPACES.find((s) => s.id === choice);

    // A fresh palace gets a fresh name (not the previous one's).
    this.palace = createEmptyPalace();
    this.root = this.palace;
    this.navStack = [];
    this.fileHandle = null;
    this.serverName = null; // a fresh world isn't bound to a saved file yet
    this.selectedId = null;
    this.editor.setNotice(null); // clear any stale "drag the geometry" message
    if (sample) {
      this.overlay.showLoading(sample.label);
      try {
        await this.viewer.loadUrl(sample.url);
      } catch (err) {
        console.error(err);
        this.toasts.error(`Couldn't load ${sample.label}.`);
      }
      setAsset(this.palace, sample.url);
      this.palace.environment = { ...this.palace.environment, ...sample.environment };
      this.overlay.hide();
    } else {
      setAsset(this.palace, this.viewer.assetFile);
    }
    this.viewer.applyEnvironment(this.palace.environment);
    this.loci.sync(this.palace);
    this.history.reset(this.root);
    if (sample && this.viewer.hasModel) this.spawnInSample(sample);
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

  /** Reveal the current locus's mnemonic. */
  private reviewReveal(): void {
    if (this.reviewIndex >= this.reviewRoute.length) return;
    const locus = this.reviewRoute[this.reviewIndex];
    this.reviewRevealed = true;
    locus.last_reviewed = new Date().toISOString();
    this.markDirty();
    const isLast = this.reviewIndex === this.reviewRoute.length - 1;
    this.review.showReveal(this.reviewIndex + 1, this.reviewRoute.length, locus.label, locus.image_prompt, isLast);
  }

  /** Move to the previous/next locus (past the end shows the done card). */
  private reviewStep(delta: 1 | -1): void {
    const next = this.reviewIndex + delta;
    if (next < 0) return;
    if (next >= this.reviewRoute.length) {
      this.reviewIndex = this.reviewRoute.length;
      this.review.showDone(this.reviewRoute.length);
      return;
    }
    this.reviewIndex = next;
    this.reviewRevealed = false;
    this.showReviewStep();
  }

  /** Space/Enter: reveal if hidden, otherwise advance. */
  private reviewAdvance(): void {
    if (this.reviewIndex >= this.reviewRoute.length) {
      this.endReview();
      return;
    }
    if (!this.reviewRevealed) this.reviewReveal();
    else this.reviewStep(1);
  }

  private endReview(): void {
    this.setMode('edit');
  }

  private gotoLocus(id: string): void {
    const locus = this.palace.loci.find((l) => l.id === id);
    if (locus) this.gotoLocusObject(locus);
  }

  /** Fly to locus #1 (or the framed model if there are no loci yet). */
  private recenterView(announce = true, instant = false): void {
    const first = lociInOrder(this.palace)[0];
    if (first) {
      this.gotoLocusObject(first, instant ? 0 : this.gotoMs);
      if (announce) this.toasts.info(`Centered on #${first.order}${first.label ? ` — ${first.label}` : ''}`);
    } else {
      this.viewer.recenter();
    }
  }

  /** Glide to a spot off the locus, looking at it. Stand back further for big objects. */
  private gotoLocusObject(locus: Locus, durationMs = this.gotoMs): void {
    const pos = this.loci.worldPosition(locus, this.scratchA);
    const normal = this.loci.worldNormal(locus, this.scratchB);
    // Stand back along the surface normal, but keep it mostly horizontal so we
    // don't end up above a floor locus or below a ceiling one.
    const horiz = new THREE.Vector3(normal.x, 0, normal.z);
    if (horiz.lengthSq() < 0.02) horiz.set(0, 0, 1);
    horiz.normalize();
    // Scale the standoff with the object so a 3–4× mesh doesn't swallow the camera.
    const s = Math.max(1, locus.object_scale ?? 1);
    const viewPos = pos.clone().addScaledVector(horiz, 2.2 * s);
    viewPos.y = pos.y + 0.8 * s;
    this.viewer.fp.setFlying(true); // float at the target, don't drop
    this.viewer.flyTo(viewPos, pos, durationMs);
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
    this.viewer.flyTo(viewPos, pos, this.gotoMs);
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
      this.serverName = null;
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
        this.serverName = null; // opened from a file, not the server
        await this.adoptPalace(opened.palace);
        // When the local server is available, nudge the migration path: this world
        // came from a file — one click of Save moves it onto the computer.
        if (this.serverOnline) {
          this.toasts.info(`Imported “${opened.palace.name}”. Click Save to keep it on your computer.`);
        }
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
    // Frame the world like Recenter does, so you don't start buried inside it.
    if (this.viewer.hasModel) this.recenterView(false, true);
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

/** A filesystem-safe base name for a server palace file. */
function sanitizeName(name: string): string {
  return name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'palace';
}

/** A short "3 min ago" style label for a save timestamp (ms). */
function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

new App();
