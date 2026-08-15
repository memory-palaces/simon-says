import { BACKGROUND_PATTERNS, DEFAULT_BACKGROUND, lociInOrder, type Decor, type Locus, type Palace, type Portal, type SceneProp } from '../model/palace';
import { DEFAULT_FAL_MODEL, FAL_MODEL_PRESETS, NONE_ID, STYLE_PRESETS } from '../model/generation';
import { downloadAsset } from './download';

interface GenState {
  options: Array<{ id: string; label: string }>;
  activeId: string;
  can3d: boolean;
  styleId: string;
  falModel: string;
}

/** Everything the panel needs to call back into the app. */
export interface EditorHandlers {
  renamePalace(name: string): void;
  enterWalk(): void;
  save(): void;
  load(): void;
  exportFile(): void;
  importFile(): void;
  openAssets(): void;
  newPalace(): void;
  startReview(): void;
  openSettings(): void;
  openGuide(): void;
  openLog(): void;
  recenter(): void;
  selectLocus(id: string): void;
  updateLabel(id: string, text: string): void;
  updatePrompt(id: string, text: string): void;
  reorder(id: string, dir: -1 | 1): void;
  deleteLocus(id: string): void;
  teleport(id: string): void;
  undo(): void;
  redo(): void;
  setBackground(hex: string): void;
  setPattern(id: string): void;
  setBrightness(value: number): void;
  setPlayerScale(value: number): void;
  toggleScaleFigure(): void;
  setBackendId(id: string): void;
  generate(id: string): void;
  clearImage(id: string): void;
  generate3d(id: string): void;
  clearMesh(id: string): void;
  mountMeshPreview(container: HTMLElement, glbDataUrl: string): void;
  updateNotes(id: string, text: string): void;
  attachImage(id: string): void;
  attachMesh(id: string): void;
  setObjectScale(id: string, value: number): void;
  setObjectRotation(id: string, axis: number, value: number): void;
  selectAttachment(id: string, index: number): void;
  removeAttachment(id: string, index: number): void;
  setStyle(id: string): void;
  setFalModel(model: string): void;
  enterPortal(id: string): void;
  removePortal(id: string): void;
  renamePortal(id: string, name: string): void;
  gotoPortal(id: string): void;
  returnToParent(): void;
  // Optional portal visuals.
  addPortalVisual(id: string, kind: 'image' | 'mesh'): void;
  removePortalVisual(id: string): void;
  updatePortalPrompt(id: string, prompt: string): void;
  generatePortalImage(id: string): void;
  attachPortalImage(id: string): void;
  attachPortalMesh(id: string): void;
  setPortalScale(id: string, value: number): void;
  setPortalRotation(id: string, axis: number, value: number): void;
  makePortal3d(id: string): void;
  // Scene props (extra elements composed around a locus).
  addProp(locusId: string, kind: 'text' | 'image' | 'mesh'): void;
  removeProp(locusId: string, propId: string): void;
  updatePropText(locusId: string, propId: string, text: string): void;
  updatePropPrompt(locusId: string, propId: string, prompt: string): void;
  generateProp(locusId: string, propId: string): void;
  attachPropImage(locusId: string, propId: string): void;
  attachPropMesh(locusId: string, propId: string): void;
  setPropOffset(locusId: string, propId: string, axis: number, value: number): void;
  setPropScale(locusId: string, propId: string, value: number): void;
  setPropRotation(locusId: string, propId: string, axis: number, value: number): void;
  placeProp(locusId: string, propId: string): void;
  makeProp3d(locusId: string, propId: string): void;
  // Free-standing decor (ambiance not tied to a locus).
  addDecor(kind: 'text' | 'image' | 'mesh'): void;
  removeDecor(id: string): void;
  updateDecorText(id: string, text: string): void;
  updateDecorPrompt(id: string, prompt: string): void;
  generateDecor(id: string): void;
  attachDecorImage(id: string): void;
  attachDecorMesh(id: string): void;
  setDecorScale(id: string, value: number): void;
  setDecorRotation(id: string, axis: number, value: number): void;
  placeDecor(id: string): void;
  makeDecor3d(id: string): void;
}

/**
 * The unlocked authoring panel: rename the palace, walk it, save/load, and edit
 * each locus's location label and — critically — the user's own mnemonic image
 * text. There is deliberately NO "suggest" or "improve" affordance: inventing the
 * bizarre association is the user's job; the machine only ever renders it.
 */
export class EditorPanel {
  private readonly root: HTMLElement;
  private readonly handlers: EditorHandlers;

  // Live references so typing in the detail fields doesn't force a full re-render
  // (which would drop focus). Structural changes call render() explicitly.
  private rowLabels = new Map<string, HTMLElement>();
  private rowPrompts = new Map<string, HTMLElement>();

  /** A transient banner (e.g. "drop this palace's .glb"). Persists across renders. */
  private notice: string | null = null;

  /** Whether the local save/open server is available (drives the header buttons). */
  private serverOnline = false;
  /** The folder the server saves into (shown so it's clear where worlds go). */
  private serverDir: string | null = null;

  /** Nesting depth + breadcrumb trail, for the Return bar. */
  private nesting: { depth: number; trail: string[] } = { depth: 0, trail: [] };

  // Kept so history state can be toggled without a full re-render (which would
  // drop focus while the user is mid-edit).
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;

  /** Active generation backend + the choices, for the per-world picker. */
  private gen: GenState = {
    options: [{ id: NONE_ID, label: 'None (text only)' }],
    activeId: NONE_ID,
    can3d: false,
    styleId: 'none',
    falModel: DEFAULT_FAL_MODEL,
  };

  constructor(mount: HTMLElement, handlers: EditorHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.className = 'editor';
    mount.appendChild(this.root);
  }

  show(): void {
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  setNotice(text: string | null): void {
    this.notice = text;
  }

  setNesting(depth: number, trail: string[]): void {
    this.nesting = { depth, trail };
  }

  setServerInfo(online: boolean, dir: string | null): void {
    this.serverOnline = online;
    this.serverDir = dir;
  }

  setGeneration(gen: GenState): void {
    this.gen = gen;
  }

  /** Update undo/redo enablement without re-rendering (preserves input focus). */
  setHistoryState(canUndo: boolean, canRedo: boolean): void {
    if (this.undoBtn) this.undoBtn.disabled = !canUndo;
    if (this.redoBtn) this.redoBtn.disabled = !canRedo;
  }

  render(palace: Palace, selectedId: string | null, canUndo = false, canRedo = false): void {
    this.rowLabels.clear();
    this.rowPrompts.clear();
    this.root.replaceChildren();

    if (this.nesting.depth > 0) {
      const bar = div('nest-bar');
      const crumb = div('nest-crumb');
      crumb.textContent = this.nesting.trail.join('  ›  ');
      const back = button('▲ Return', '', () => this.handlers.returnToParent());
      back.title = 'Return to parent world (Q)';
      bar.append(crumb, back);
      this.root.appendChild(bar);
    }

    if (this.notice) {
      const banner = div('editor-notice');
      banner.textContent = this.notice;
      this.root.appendChild(banner);
    }

    // --- Header: palace name + primary actions ---------------------------------
    const header = div('editor-header');
    const name = document.createElement('input');
    name.className = 'palace-name';
    name.value = palace.name;
    name.setAttribute('aria-label', 'World name');
    name.oninput = () => this.handlers.renamePalace(name.value);
    header.appendChild(name);

    const actions = div('editor-actions');
    actions.appendChild(button('▶ Enter', 'primary', () => this.handlers.enterWalk()));
    if (this.serverOnline) {
      // Two systems: Save/Open keep worlds on THIS computer; Import/Export use files.
      const save = button('Save', '', () => this.handlers.save());
      save.title = this.serverDir ? `Save this world into ${this.serverDir}` : 'Save this world on your computer';
      const open = button('Open', '', () => this.handlers.load());
      open.title = this.serverDir ? `Open a world from ${this.serverDir}` : 'Open a world saved on your computer';
      const imp = button('Import', '', () => this.handlers.importFile());
      imp.title = 'Load a .json world file — e.g. one you downloaded earlier';
      const exp = button('Export', '', () => this.handlers.exportFile());
      exp.title = 'Download this world as a .json file (to share or back up)';
      actions.append(save, open, sep(), imp, exp);
    } else {
      const save = button('Save', '', () => this.handlers.save());
      save.title = 'Download this world as a .json file';
      const open = button('Open', '', () => this.handlers.load());
      open.title = 'Open a .json world file';
      actions.append(save, open);
    }
    actions.appendChild(button('New', '', () => this.handlers.newPalace()));
    const review = button('Review ▸', '', () => this.handlers.startReview());
    review.disabled = palace.loci.length === 0;
    actions.appendChild(review);

    const assets = button('🗂 Assets', '', () => this.handlers.openAssets());
    assets.title = 'See and reuse every image / 3D model in this world';
    actions.appendChild(assets);

    const recenter = button('⌖ Recenter', '', () => this.handlers.recenter());
    recenter.title = 'Drop back onto the floor (R)';
    actions.appendChild(recenter);

    this.undoBtn = button('↶', '', () => this.handlers.undo());
    this.undoBtn.title = 'Undo (Ctrl/Cmd+Z)';
    this.undoBtn.disabled = !canUndo;
    this.redoBtn = button('↷', '', () => this.handlers.redo());
    this.redoBtn.title = 'Redo (Ctrl/Cmd+Shift+Z)';
    this.redoBtn.disabled = !canRedo;
    actions.append(this.undoBtn, this.redoBtn);

    const gear = button('⚙', '', () => this.handlers.openSettings());
    gear.title = 'Settings (keys, controls)';
    actions.appendChild(gear);

    const guide = button('📖 Guide', '', () => this.handlers.openGuide());
    guide.title = 'How to use Simon Says — the quick-start guide';
    actions.appendChild(guide);

    const log = button('>_', '', () => this.handlers.openLog());
    log.title = 'Activity log / console';
    actions.appendChild(log);

    header.appendChild(actions);
    this.root.appendChild(header);

    const autosave = div('editor-autosave');
    if (this.serverOnline) {
      const folder = this.serverDir ? `<code>${escapeHtml(this.serverDir)}</code>` : 'a folder on your computer';
      autosave.innerHTML =
        `✓ Autosaves as you work. <b>Save</b> / <b>Open</b> keep worlds in ${folder}; <b>Import</b> / <b>Export</b> use .json files. ` +
        'Have a .json from before? <b>Import</b> it, then <b>Save</b>.';
    } else {
      autosave.textContent = '✓ Autosaves to this browser as you work · Save / Open use .json files';
    }
    this.root.appendChild(autosave);

    // --- How-to hint -----------------------------------------------------------
    const hint = div('editor-hint');
    hint.innerHTML =
      palace.loci.length === 0
        ? 'No loci yet. Press <b>▶ Enter</b>, look at a wall or object, and press <kbd>T</kbd> to drop one. <kbd>?</kbd> for all controls.'
        : 'Click a #number to fly to it, a title to collapse. In walk mode: <kbd>T</kbd> drop · aim at a marker then <kbd>B</kbd> delete / <kbd>G</kbd> move.';
    this.root.appendChild(hint);

    // --- Route list ------------------------------------------------------------
    const list = div('loci-list');
    const ordered = lociInOrder(palace);
    for (const locus of ordered) {
      const row = div('locus-row' + (locus.id === selectedId ? ' selected' : ''));

      // Click the number to fly to the locus.
      const num = div('locus-num clickable');
      num.textContent = String(locus.order);
      num.title = 'Fly to this locus';
      num.onclick = () => this.handlers.teleport(locus.id);
      row.appendChild(num);

      const text = div('locus-text');
      const labelEl = div('locus-label');
      labelEl.textContent = locus.label || '(unlabeled location)';
      if (!locus.label) labelEl.classList.add('empty');
      if (locus.child_palace) {
        const badge = document.createElement('span');
        badge.className = 'locus-door';
        badge.textContent = '↳';
        badge.title = 'has an inner world';
        labelEl.prepend(badge);
      }
      const promptEl = div('locus-prompt');
      promptEl.textContent = locus.image_prompt || 'no mnemonic yet';
      if (!locus.image_prompt) promptEl.classList.add('empty');
      text.append(labelEl, promptEl);
      // Click the title to open, or collapse if it's already the open one.
      text.onclick = () => this.handlers.selectLocus(locus.id === selectedId ? '' : locus.id);
      row.appendChild(text);
      this.rowLabels.set(locus.id, labelEl);
      this.rowPrompts.set(locus.id, promptEl);

      const ctrls = div('locus-ctrls');
      ctrls.appendChild(iconButton('▲', 'move up', () => this.handlers.reorder(locus.id, -1)));
      ctrls.appendChild(iconButton('▼', 'move down', () => this.handlers.reorder(locus.id, 1)));
      ctrls.appendChild(iconButton('⌖', 'go to', () => this.handlers.teleport(locus.id)));
      ctrls.appendChild(iconButton('🗑', 'delete', () => this.handlers.deleteLocus(locus.id)));
      row.appendChild(ctrls);

      list.appendChild(row);

      // Inline detail editor for the selected locus.
      if (locus.id === selectedId) {
        list.appendChild(this.detail(locus));
      }
    }
    this.root.appendChild(list);

    // --- Portals to other worlds -----------------------------------------------
    this.root.appendChild(this.portalsSection(palace));

    // --- Free-standing decor (ambiance not tied to any locus) ------------------
    this.root.appendChild(this.decorSection(palace));

    // --- This world: image pipeline + background -------------------------------
    this.root.appendChild(this.generationSection());
    this.root.appendChild(this.worldSection(palace));
  }

  /** Manage free-standing decor: elements placed for ambiance, no locus attached. */
  private decorSection(palace: Palace): HTMLElement {
    const wrap = div('scene-section');
    const head = div('scene-head');
    const title = document.createElement('span');
    title.className = 'scene-title';
    const count = palace.decor?.length ?? 0;
    title.textContent = `Decor${count ? ` (${count})` : ''}`;
    head.appendChild(title);
    wrap.appendChild(head);

    const hint = div('scene-hint');
    hint.textContent = 'Set-dressing placed anywhere, not part of the recall route. Add one, then 📍 to place it in the world.';
    wrap.appendChild(hint);

    for (const d of palace.decor ?? []) wrap.appendChild(this.decorCard(d));

    const addRow = div('locus-gen-row');
    addRow.appendChild(button('+ Text', '', () => this.handlers.addDecor('text')));
    addRow.appendChild(button('+ Image', '', () => this.handlers.addDecor('image')));
    addRow.appendChild(button('+ 3D', '', () => this.handlers.addDecor('mesh')));
    wrap.appendChild(addRow);
    return wrap;
  }

  private decorCard(d: Decor): HTMLElement {
    const card = div('prop-card');
    const head = div('prop-head');
    const badge = document.createElement('span');
    badge.className = 'prop-badge prop-' + d.kind;
    badge.textContent = d.kind === 'text' ? 'Text' : d.kind === 'image' ? 'Image' : '3D';
    head.appendChild(badge);
    const headBtns = div('prop-head-btns');
    headBtns.appendChild(iconButton('📍', 'Place in the world — aim at a surface and click', () => this.handlers.placeDecor(d.id)));
    headBtns.appendChild(iconButton('✕', 'Remove this decor', () => this.handlers.removeDecor(d.id)));
    head.appendChild(headBtns);
    card.appendChild(head);

    if (d.kind === 'text') {
      const f = field('Caption', 'floating text, e.g. "MIND THE GAP"');
      const input = f.input as HTMLInputElement;
      input.value = d.text ?? '';
      input.oninput = () => this.handlers.updateDecorText(d.id, input.value);
      card.appendChild(f.el);
    } else {
      const f = field('Image prompt (rendered by the AI)', 'e.g. "a tattered ship\'s pennant"', true);
      const input = f.input as HTMLTextAreaElement;
      input.value = d.image_prompt ?? '';
      input.oninput = () => this.handlers.updateDecorPrompt(d.id, input.value);
      card.appendChild(f.el);

      const row = div('locus-gen-row');
      if (d.kind === 'image') {
        row.appendChild(button('✨ Render', 'primary', () => this.handlers.generateDecor(d.id)));
        row.appendChild(button('📎 Attach image', '', () => this.handlers.attachDecorImage(d.id)));
      } else {
        row.appendChild(button('📎 Attach 3D', '', () => this.handlers.attachDecorMesh(d.id)));
      }
      card.appendChild(row);

      if (d.kind === 'image' && d.src) {
        const thumb = document.createElement('img');
        thumb.className = 'prop-thumb';
        thumb.src = d.src;
        card.appendChild(thumb);
        const row2 = div('locus-gen-row');
        if (this.gen.can3d) row2.appendChild(button('⬗ Make 3D', '', () => this.handlers.makeDecor3d(d.id)));
        row2.appendChild(iconButton('⬇', 'download image', () => downloadAsset(d.src!, `decor-${d.id}`)));
        card.appendChild(row2);
      } else if (d.kind === 'mesh' && d.src) {
        const holder = div('prop-mesh-preview');
        this.handlers.mountMeshPreview(holder, d.src);
        card.appendChild(holder);
        const row2 = div('locus-gen-row');
        row2.appendChild(iconButton('⬇', 'download 3D model', () => downloadAsset(d.src!, `decor-${d.id}`)));
        card.appendChild(row2);
      }
    }

    card.appendChild(
      sliderRow({
        label: 'Scale',
        min: 0.2,
        max: 5,
        step: 0.1,
        value: d.scale ?? 1,
        def: 1,
        onChange: (v) => this.handlers.setDecorScale(d.id, v),
      }),
    );
    if (d.kind === 'mesh') {
      const rot = d.rotation ?? [0, 0, 0];
      ['Rotate X', 'Rotate Y', 'Rotate Z'].forEach((label, axis) => {
        card.appendChild(
          sliderRow({
            label,
            min: -180,
            max: 180,
            step: 5,
            value: rot[axis],
            def: 0,
            onChange: (v) => this.handlers.setDecorRotation(d.id, axis, v),
          }),
        );
      });
    }
    return card;
  }

  /** Background colour picker + preset swatches; changes apply live and are undoable. */
  private worldSection(palace: Palace): HTMLElement {
    const wrap = div('editor-world');
    const title = div('ctrl-title');
    title.textContent = 'World background';
    wrap.appendChild(title);

    const row = div('world-row');
    const color = document.createElement('input');
    color.type = 'color';
    color.className = 'world-color';
    color.value = palace.environment?.background ?? DEFAULT_BACKGROUND;
    color.oninput = () => this.handlers.setBackground(color.value);
    row.appendChild(color);

    const presets: Array<[string, string]> = [
      ['Sky', DEFAULT_BACKGROUND],
      ['Mint', '#bfe3d0'],
      ['Peach', '#f2d6c0'],
      ['Lavender', '#d7cef0'],
      ['Sand', '#e9dcc3'],
      ['Slate', '#20242c'],
      ['Abyss', '#0a0a0b'],
    ];
    for (const [name, hex] of presets) {
      const sw = document.createElement('button');
      sw.className = 'swatch';
      sw.title = name;
      sw.style.background = hex;
      sw.onclick = () => {
        color.value = hex;
        this.handlers.setBackground(hex);
      };
      row.appendChild(sw);
    }
    wrap.appendChild(row);

    // Gradient-sky patterns (cheerful).
    const patternRow = div('world-row');
    for (const pat of BACKGROUND_PATTERNS) {
      const sw = document.createElement('button');
      sw.className = 'swatch' + (palace.environment?.pattern === pat.id ? ' active' : '');
      sw.title = pat.label;
      sw.style.background = `linear-gradient(${pat.top}, ${pat.bottom})`;
      sw.onclick = () => this.handlers.setPattern(pat.id);
      patternRow.appendChild(sw);
    }
    wrap.appendChild(patternRow);

    // Brightness — lifts dark interiors (scales all lights + the headlamp).
    wrap.appendChild(
      sliderRow({
        label: 'Brightness',
        min: 0.3,
        max: 3,
        step: 0.1,
        value: palace.environment?.brightness ?? 1,
        def: 1,
        onChange: (v) => this.handlers.setBrightness(v),
      }),
    );

    // Player scale — be tiny (space feels huge) or a giant. The 🚶 button drops a
    // person-sized reference so you can eyeball the scale.
    const figBtn = iconButton('🚶', 'Toggle a person-sized scale reference', () => this.handlers.toggleScaleFigure());
    wrap.appendChild(
      sliderRow({
        label: 'Player scale',
        min: 0.1,
        max: 5,
        step: 0.1,
        value: palace.environment?.playerScale ?? 1,
        def: 1,
        onChange: (v) => this.handlers.setPlayerScale(v),
        trailing: figBtn,
      }),
    );
    return wrap;
  }

  private detail(locus: Locus): HTMLElement {
    const id = locus.id;
    const wrap = div('locus-detail');

    const lblField = field('Location cue', 'Where is it? e.g. "Kitchen island, north corner"');
    const lbl = lblField.input as HTMLInputElement;
    lbl.value = locus.label;
    lbl.oninput = () => {
      this.handlers.updateLabel(id, lbl.value);
      const row = this.rowLabels.get(id);
      if (row) {
        row.textContent = lbl.value || '(unlabeled location)';
        row.classList.toggle('empty', !lbl.value);
      }
    };
    wrap.appendChild(lblField.el);

    const notesField = field('Notes', 'what it represents, how you got here, links…', true);
    const notes = notesField.input as HTMLTextAreaElement;
    notes.value = locus.notes ?? '';
    notes.oninput = () => this.handlers.updateNotes(id, notes.value);
    wrap.appendChild(notesField.el);

    const prField = field('Image prompt (rendered by the AI)', 'e.g. "a screaming lobster wearing my grandmother\'s reading glasses"', true);
    const pr = prField.input as HTMLTextAreaElement;
    pr.value = locus.image_prompt;
    pr.oninput = () => {
      this.handlers.updatePrompt(id, pr.value);
      const row = this.rowPrompts.get(id);
      if (row) {
        row.textContent = pr.value || 'no mnemonic yet';
        row.classList.toggle('empty', !pr.value);
      }
    };
    wrap.appendChild(prField.el);

    // Generate from the prompt (always available — falls back to the offline
    // placeholder if no pipeline is chosen for this world).
    wrap.appendChild(this.generateControls(locus));

    // Gallery: every image/mesh made or attached here — click to make it the one
    // that represents this locus; ✕ to discard it.
    if (locus.gallery && locus.gallery.length > 0) {
      wrap.appendChild(this.galleryStrip(locus));
    }

    // Attach your own image / 3D model (e.g. made elsewhere in fal.ai).
    const attachRow = div('locus-gen-row');
    attachRow.appendChild(button('📎 Attach image', '', () => this.handlers.attachImage(locus.id)));
    attachRow.appendChild(button('📎 Attach 3D', '', () => this.handlers.attachMesh(locus.id)));
    wrap.appendChild(attachRow);

    // Per-locus object scale (only meaningful once something is attached).
    if (locus.image_2d || locus.mesh_3d) {
      wrap.appendChild(
        sliderRow({
          label: 'Object scale',
          min: 0.2,
          max: 5,
          step: 0.1,
          value: locus.object_scale ?? 1,
          def: 1,
          onChange: (v) => this.handlers.setObjectScale(locus.id, v),
        }),
      );
    }

    // Rotation for a 3D mesh (images are camera-facing billboards, no rotation).
    if (locus.mesh_3d) {
      const rot = locus.object_rotation ?? [0, 0, 0];
      ['Rotate X', 'Rotate Y', 'Rotate Z'].forEach((label, axis) => {
        wrap.appendChild(
          sliderRow({
            label,
            min: -180,
            max: 180,
            step: 5,
            value: rot[axis],
            def: 0,
            onChange: (v) => this.handlers.setObjectRotation(locus.id, axis, v),
          }),
        );
      });
    }

    // Scene: extra props composed around this locus for a richer tableau.
    wrap.appendChild(this.sceneSection(locus));

    return wrap;
  }

  /** The "Scene" section: add/manage extra props (text, image, 3D) around a locus. */
  private sceneSection(locus: Locus): HTMLElement {
    const wrap = div('scene-section');
    const head = div('scene-head');
    const title = document.createElement('span');
    title.className = 'scene-title';
    const count = locus.props?.length ?? 0;
    title.textContent = `Scene${count ? ` (${count})` : ''}`;
    head.appendChild(title);
    wrap.appendChild(head);

    const hint = div('scene-hint');
    hint.textContent = 'Build a richer tableau: add captions, billboards, or 3D props. Use 📍 to place one in the world (aim & click), or the sliders below.';
    wrap.appendChild(hint);

    for (const prop of locus.props ?? []) {
      wrap.appendChild(this.propCard(locus, prop));
    }

    const addRow = div('locus-gen-row');
    addRow.appendChild(button('+ Text', '', () => this.handlers.addProp(locus.id, 'text')));
    addRow.appendChild(button('+ Image', '', () => this.handlers.addProp(locus.id, 'image')));
    addRow.appendChild(button('+ 3D', '', () => this.handlers.addProp(locus.id, 'mesh')));
    wrap.appendChild(addRow);
    return wrap;
  }

  private propCard(locus: Locus, prop: SceneProp): HTMLElement {
    const card = div('prop-card');
    const head = div('prop-head');
    const badge = document.createElement('span');
    badge.className = 'prop-badge prop-' + prop.kind;
    badge.textContent = prop.kind === 'text' ? 'Text' : prop.kind === 'image' ? 'Image' : '3D';
    head.appendChild(badge);
    const headBtns = div('prop-head-btns');
    headBtns.appendChild(iconButton('📍', 'Place in the world — aim at a surface and click', () => this.handlers.placeProp(locus.id, prop.id)));
    headBtns.appendChild(iconButton('✕', 'Remove this prop', () => this.handlers.removeProp(locus.id, prop.id)));
    head.appendChild(headBtns);
    card.appendChild(head);

    if (prop.kind === 'text') {
      const f = field('Caption', 'floating text, e.g. "TOP OF THE STAIRS"');
      const input = f.input as HTMLInputElement;
      input.value = prop.text ?? '';
      input.oninput = () => this.handlers.updatePropText(locus.id, prop.id, input.value);
      card.appendChild(f.el);
    } else {
      const f = field('Image prompt (rendered by the AI)', 'e.g. "a brass diving helmet, dented"', true);
      const input = f.input as HTMLTextAreaElement;
      input.value = prop.image_prompt ?? '';
      input.oninput = () => this.handlers.updatePropPrompt(locus.id, prop.id, input.value);
      card.appendChild(f.el);

      const row = div('locus-gen-row');
      if (prop.kind === 'image') {
        row.appendChild(button('✨ Render', 'primary', () => this.handlers.generateProp(locus.id, prop.id)));
        row.appendChild(button('📎 Attach image', '', () => this.handlers.attachPropImage(locus.id, prop.id)));
      } else {
        row.appendChild(button('📎 Attach 3D', '', () => this.handlers.attachPropMesh(locus.id, prop.id)));
      }
      card.appendChild(row);

      if (prop.kind === 'image' && prop.src) {
        const thumb = document.createElement('img');
        thumb.className = 'prop-thumb';
        thumb.src = prop.src;
        card.appendChild(thumb);
        const row2 = div('locus-gen-row');
        // Upgrade the billboard to a real 3D object (gated on 2D + a can-3D pipeline).
        if (this.gen.can3d) row2.appendChild(button('⬗ Make 3D', '', () => this.handlers.makeProp3d(locus.id, prop.id)));
        row2.appendChild(iconButton('⬇', 'download image', () => downloadAsset(prop.src!, `prop-${prop.id}`)));
        card.appendChild(row2);
      } else if (prop.kind === 'mesh' && prop.src) {
        const holder = div('prop-mesh-preview');
        this.handlers.mountMeshPreview(holder, prop.src);
        card.appendChild(holder);
        const row2 = div('locus-gen-row');
        row2.appendChild(iconButton('⬇', 'download 3D model', () => downloadAsset(prop.src!, `prop-${prop.id}`)));
        card.appendChild(row2);
      }
    }

    // Placement: offset (left/right, up/down, in/out), scale, and rotation (mesh).
    const off = prop.offset ?? [0, 0, 0];
    (['Left · right', 'Down · up', 'In · out'] as const).forEach((label, axis) => {
      card.appendChild(
        sliderRow({
          label,
          min: -4,
          max: 4,
          step: 0.1,
          value: off[axis],
          def: 0,
          onChange: (v) => this.handlers.setPropOffset(locus.id, prop.id, axis, v),
        }),
      );
    });
    card.appendChild(
      sliderRow({
        label: 'Scale',
        min: 0.2,
        max: 5,
        step: 0.1,
        value: prop.scale ?? 1,
        def: 1,
        onChange: (v) => this.handlers.setPropScale(locus.id, prop.id, v),
      }),
    );
    if (prop.kind === 'mesh') {
      const rot = prop.rotation ?? [0, 0, 0];
      ['Rotate X', 'Rotate Y', 'Rotate Z'].forEach((label, axis) => {
        card.appendChild(
          sliderRow({
            label,
            min: -180,
            max: 180,
            step: 5,
            value: rot[axis],
            def: 0,
            onChange: (v) => this.handlers.setPropRotation(locus.id, prop.id, axis, v),
          }),
        );
      });
    }
    return card;
  }

  /** Generate / regenerate / clear the rendered image for one locus. */
  private generateControls(locus: Locus): HTMLElement {
    const wrap = div('locus-gen');
    if (!locus.image_prompt.trim()) {
      const hint = div('locus-gen-hint');
      hint.textContent = 'Write your mnemonic image above, then render it.';
      wrap.appendChild(hint);
      return wrap;
    }

    const row = div('locus-gen-row');
    row.appendChild(button(locus.image_2d ? '↻ Regenerate' : '✦ Render image', '', () => this.handlers.generate(locus.id)));
    if (locus.image_2d) {
      row.appendChild(iconButton('⬇', 'download image', () => downloadAsset(locus.image_2d!, assetName(locus, 'image'))));
      row.appendChild(iconButton('🗑', 'remove image', () => this.handlers.clearImage(locus.id)));
    }
    wrap.appendChild(row);

    if (locus.image_2d) {
      const thumb = document.createElement('img');
      thumb.className = 'locus-thumb';
      thumb.src = locus.image_2d;
      wrap.appendChild(thumb);
    }

    // Second stage: turn the approved image into a 3D mesh (gated on 2D + can3d).
    if (locus.image_2d && this.gen.can3d) {
      const row = div('locus-gen-row');
      row.appendChild(
        button(locus.mesh_3d ? '↻ Remake 3D' : '⬗ Make 3D', '', () => this.handlers.generate3d(locus.id)),
      );
      if (locus.mesh_3d) {
        const tag = div('locus-gen-hint');
        tag.textContent = '3D mesh ✓';
        row.appendChild(tag);
        row.appendChild(iconButton('⬇', 'download 3D model', () => downloadAsset(locus.mesh_3d!, assetName(locus, 'mesh'))));
        row.appendChild(iconButton('🗑', 'remove 3D', () => this.handlers.clearMesh(locus.id)));
      }
      wrap.appendChild(row);

      // Orbit preview of the generated mesh.
      if (locus.mesh_3d) {
        const preview = div('mesh-preview');
        wrap.appendChild(preview);
        this.handlers.mountMeshPreview(preview, locus.mesh_3d);
      }
    }
    return wrap;
  }

  /** Per-world pipeline picker. Credentials live in Settings (the gear). */
  /** Thumbnails of every image/mesh version for this locus; click to activate. */
  private galleryStrip(locus: Locus): HTMLElement {
    const strip = div('gallery');
    const title = div('locus-gen-hint');
    title.textContent = 'Versions (click to use)';
    strip.appendChild(title);

    const grid = div('gallery-grid');
    (locus.gallery ?? []).forEach((att, i) => {
      const cell = div('gallery-cell');
      const active =
        (att.type === 'image' && locus.image_2d === att.src) || (att.type === 'mesh' && locus.mesh_3d === att.src);
      if (active) cell.classList.add('active');
      cell.onclick = () => this.handlers.selectAttachment(locus.id, i);

      if (att.type === 'image') {
        const img = document.createElement('img');
        img.src = att.src;
        cell.appendChild(img);
      } else {
        const badge = div('gallery-mesh');
        badge.textContent = '3D';
        cell.appendChild(badge);
      }
      const rm = document.createElement('button');
      rm.className = 'gallery-x';
      rm.textContent = '✕';
      rm.title = 'remove this version';
      rm.onclick = (e) => {
        e.stopPropagation();
        this.handlers.removeAttachment(locus.id, i);
      };
      cell.appendChild(rm);
      grid.appendChild(cell);
    });
    strip.appendChild(grid);
    return strip;
  }

  /** Portals in this world — name, fly-to, enter, remove. Drop with P in walk. */
  private portalsSection(palace: Palace): HTMLElement {
    const wrap = div('editor-gen');
    const title = div('ctrl-title');
    title.textContent = 'Portals';
    wrap.appendChild(title);

    const portals = palace.portals ?? [];
    if (portals.length === 0) {
      const hint = div('locus-gen-hint');
      hint.innerHTML = 'None yet. In walk mode press <kbd>P</kbd> to drop a portal, then aim at it and press <kbd>Enter</kbd> to go through.';
      wrap.appendChild(hint);
      return wrap;
    }

    for (const portal of portals) {
      const row = div('locus-row');
      const num = div('locus-num clickable');
      num.textContent = '◎';
      num.title = 'fly to portal';
      num.onclick = () => this.handlers.gotoPortal(portal.id);
      row.appendChild(num);

      const input = document.createElement('input');
      input.className = 'portal-name';
      input.value = portal.label;
      input.placeholder = portal.target ? portal.target.name : 'unnamed portal';
      input.oninput = () => this.handlers.renamePortal(portal.id, input.value);
      row.appendChild(input);

      const ctrls = div('locus-ctrls');
      ctrls.appendChild(iconButton('↳', 'enter', () => this.handlers.enterPortal(portal.id)));
      ctrls.appendChild(iconButton('🗑', 'remove portal', () => this.handlers.removePortal(portal.id)));
      row.appendChild(ctrls);
      wrap.appendChild(row);
      wrap.appendChild(this.portalVisualBlock(portal));
    }
    return wrap;
  }

  /** Optional image/3D shown at a doorway (besides the ring). */
  private portalVisualBlock(portal: Portal): HTMLElement {
    const card = div('prop-card');
    if (!portal.kind) {
      const hint = div('scene-hint');
      hint.textContent = 'Doorway visual (optional):';
      card.appendChild(hint);
      const btns = div('locus-gen-row');
      btns.appendChild(button('+ Image', '', () => this.handlers.addPortalVisual(portal.id, 'image')));
      btns.appendChild(button('+ 3D', '', () => this.handlers.addPortalVisual(portal.id, 'mesh')));
      card.appendChild(btns);
      return card;
    }

    const head = div('prop-head');
    const badge = document.createElement('span');
    badge.className = 'prop-badge prop-' + portal.kind;
    badge.textContent = portal.kind === 'image' ? 'Image' : '3D';
    head.appendChild(badge);
    head.appendChild(iconButton('✕', 'Remove visual', () => this.handlers.removePortalVisual(portal.id)));
    card.appendChild(head);

    const f = field('Image prompt (rendered by the AI)', 'e.g. "an ornate archway of vines"', true);
    const input = f.input as HTMLTextAreaElement;
    input.value = portal.image_prompt ?? '';
    input.oninput = () => this.handlers.updatePortalPrompt(portal.id, input.value);
    card.appendChild(f.el);

    const row = div('locus-gen-row');
    if (portal.kind === 'image') {
      row.appendChild(button('✨ Render', 'primary', () => this.handlers.generatePortalImage(portal.id)));
      row.appendChild(button('📎 Attach image', '', () => this.handlers.attachPortalImage(portal.id)));
    } else {
      row.appendChild(button('📎 Attach 3D', '', () => this.handlers.attachPortalMesh(portal.id)));
    }
    card.appendChild(row);

    if (portal.kind === 'image' && portal.src) {
      const thumb = document.createElement('img');
      thumb.className = 'prop-thumb';
      thumb.src = portal.src;
      card.appendChild(thumb);
      const row2 = div('locus-gen-row');
      if (this.gen.can3d) row2.appendChild(button('⬗ Make 3D', '', () => this.handlers.makePortal3d(portal.id)));
      row2.appendChild(iconButton('⬇', 'download image', () => downloadAsset(portal.src!, `portal-${portal.id}`)));
      card.appendChild(row2);
    } else if (portal.kind === 'mesh' && portal.src) {
      const holder = div('prop-mesh-preview');
      this.handlers.mountMeshPreview(holder, portal.src);
      card.appendChild(holder);
      const row2 = div('locus-gen-row');
      row2.appendChild(iconButton('⬇', 'download 3D model', () => downloadAsset(portal.src!, `portal-${portal.id}`)));
      card.appendChild(row2);
    }

    card.appendChild(
      sliderRow({
        label: 'Scale',
        min: 0.2,
        max: 5,
        step: 0.1,
        value: portal.scale ?? 1,
        def: 1,
        onChange: (v) => this.handlers.setPortalScale(portal.id, v),
      }),
    );
    if (portal.kind === 'mesh') {
      const rot = portal.rotation ?? [0, 0, 0];
      ['Rotate X', 'Rotate Y', 'Rotate Z'].forEach((label, axis) => {
        card.appendChild(
          sliderRow({
            label,
            min: -180,
            max: 180,
            step: 5,
            value: rot[axis],
            def: 0,
            onChange: (v) => this.handlers.setPortalRotation(portal.id, axis, v),
          }),
        );
      });
    }
    return card;
  }

  private generationSection(): HTMLElement {
    const wrap = div('editor-gen');
    const title = div('ctrl-title');
    title.textContent = 'Image pipeline for this world';
    wrap.appendChild(title);

    const select = document.createElement('select');
    select.className = 'gen-select';
    for (const opt of this.gen.options) {
      const o = document.createElement('option');
      o.value = opt.id;
      o.textContent = opt.label;
      if (opt.id === this.gen.activeId) o.selected = true;
      select.appendChild(o);
    }
    select.onchange = () => this.handlers.setBackendId(select.value);
    wrap.appendChild(select);

    if (this.gen.activeId !== NONE_ID) {
      // Quick model switch (fal only) — different models suit different subjects.
      if (this.gen.activeId === 'fal') {
        wrap.appendChild(
          labeledSelect('Model', FAL_MODEL_PRESETS, this.gen.falModel, (v) => this.handlers.setFalModel(v)),
        );
      }
      // Style modifier — a rendering suffix, not a change to the mnemonic.
      wrap.appendChild(
        labeledSelect(
          'Style',
          STYLE_PRESETS.map((s) => ({ id: s.id, label: s.label })),
          this.gen.styleId,
          (v) => this.handlers.setStyle(v),
        ),
      );

      const hint = div('locus-gen-hint');
      hint.innerHTML = 'Keys/endpoint live in <b>Settings</b> (⚙). “3D-ready” style favours a single object on a plain background.';
      wrap.appendChild(hint);
    }
    return wrap;
  }
}

// --- tiny DOM helpers -------------------------------------------------------

function div(className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

/** A thin vertical divider to group related header buttons. */
function sep(): HTMLElement {
  return div('editor-sep');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/** A filesystem-safe base name for a locus's exported asset. */
function assetName(locus: Locus, kind: 'image' | 'mesh'): string {
  const base = (locus.label || `locus-${locus.order}`).trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'asset';
  return `${base}-${kind}`;
}

/**
 * A labelled slider with an exact number box beside it, a notch marking the
 * default value, and double-click (on either control) to snap back to default.
 */
function sliderRow(opts: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  def: number;
  onChange: (v: number) => void;
  trailing?: HTMLElement;
}): HTMLElement {
  const row = div('slider-row');
  const lab = document.createElement('span');
  lab.className = 'slider-label';
  lab.textContent = opts.label;

  const wrap = div('slider-wrap');
  const rng = document.createElement('input');
  rng.type = 'range';
  rng.min = String(opts.min);
  rng.max = String(opts.max);
  rng.step = String(opts.step);
  rng.value = String(opts.value);
  rng.title = 'double-click to reset to default';

  // Notch at the default position. The thumb centre only travels between half a
  // thumb-width in from each end, so offset by that (≈THUMB px) or the mark drifts
  // off the knob toward the extremes.
  const THUMB = 14; // matches the styled thumb width in style.css
  const notch = div('slider-notch');
  const frac = Math.max(0, Math.min(1, (opts.def - opts.min) / (opts.max - opts.min)));
  notch.style.left = `calc(${THUMB / 2}px + ${frac.toFixed(4)} * (100% - ${THUMB}px))`;
  notch.title = `default ${opts.def}`;
  wrap.append(rng, notch);

  const num = document.createElement('input');
  num.type = 'number';
  num.className = 'slider-num';
  num.min = String(opts.min);
  num.max = String(opts.max);
  num.step = String(opts.step);
  num.value = String(opts.value);

  const apply = (v: number, echoNum = true): void => {
    if (Number.isNaN(v)) v = opts.def;
    rng.value = String(v);
    if (echoNum) num.value = String(v);
    opts.onChange(v);
  };
  rng.oninput = () => apply(parseFloat(rng.value));
  num.oninput = () => apply(parseFloat(num.value), false);
  rng.ondblclick = () => apply(opts.def);
  num.ondblclick = () => apply(opts.def);

  row.append(lab, wrap, num);
  if (opts.trailing) row.append(opts.trailing);
  return row;
}

function labeledSelect(
  label: string,
  options: Array<{ id: string; label: string }>,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const el = div('field');
  const lab = document.createElement('label');
  lab.textContent = label;
  const select = document.createElement('select');
  select.className = 'gen-select';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    if (opt.id === value) o.selected = true;
    select.appendChild(o);
  }
  select.onchange = () => onChange(select.value);
  lab.appendChild(select);
  el.appendChild(lab);
  return el;
}

function button(text: string, variant: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'btn ' + variant;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function iconButton(glyph: string, title: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.textContent = glyph;
  b.title = title;
  b.onclick = onClick;
  return b;
}

function field(labelText: string, placeholder: string, multiline = false): { el: HTMLElement; input: HTMLElement } {
  const el = div('field');
  const lab = document.createElement('label');
  lab.textContent = labelText;
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.setAttribute('placeholder', placeholder);
  if (!multiline) (input as HTMLInputElement).type = 'text';
  lab.appendChild(input);
  el.appendChild(lab);
  return { el, input };
}
