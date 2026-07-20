import { DEFAULT_BACKGROUND, lociInOrder, type Locus, type Palace } from '../model/palace';
import { DEFAULT_FAL_MODEL, FAL_MODEL_PRESETS, NONE_ID, STYLE_PRESETS } from '../model/generation';

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
  newPalace(): void;
  startReview(): void;
  openSettings(): void;
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
  setBrightness(value: number): void;
  setPlayerScale(value: number): void;
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
      back.title = 'Return to parent world (Backspace)';
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
    actions.appendChild(button('Save', '', () => this.handlers.save()));
    actions.appendChild(button('Load', '', () => this.handlers.load()));
    actions.appendChild(button('New', '', () => this.handlers.newPalace()));
    const review = button('Review ▸', '', () => this.handlers.startReview());
    review.disabled = palace.loci.length === 0;
    actions.appendChild(review);

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

    const log = button('>_', '', () => this.handlers.openLog());
    log.title = 'Activity log / console';
    actions.appendChild(log);

    header.appendChild(actions);
    this.root.appendChild(header);

    const autosave = div('editor-autosave');
    autosave.textContent = '✓ Autosaves to this browser as you work · Save exports a .json backup';
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

    // --- This world: image pipeline + background -------------------------------
    this.root.appendChild(this.generationSection());
    this.root.appendChild(this.worldSection(palace));
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

    // Brightness — lifts dark interiors (scales all lights + the headlamp).
    const brightRow = div('bright-row');
    const brightLabel = document.createElement('span');
    brightLabel.className = 'bright-label';
    brightLabel.textContent = 'Brightness';
    const bright = document.createElement('input');
    bright.type = 'range';
    bright.min = '0.3';
    bright.max = '3';
    bright.step = '0.1';
    bright.value = String(palace.environment?.brightness ?? 1);
    bright.oninput = () => this.handlers.setBrightness(parseFloat(bright.value));
    bright.ondblclick = () => {
      bright.value = '1';
      this.handlers.setBrightness(1);
    };
    bright.title = 'double-click to reset';
    brightRow.append(brightLabel, bright);
    wrap.appendChild(brightRow);

    // Player scale — be tiny (space feels huge) or a giant. Logarithmic-ish range.
    const scaleRow = div('bright-row');
    const scaleLabel = document.createElement('span');
    scaleLabel.className = 'bright-label';
    scaleLabel.textContent = 'Player scale';
    const scale = document.createElement('input');
    scale.type = 'range';
    scale.min = '0.1';
    scale.max = '5';
    scale.step = '0.1';
    scale.value = String(palace.environment?.playerScale ?? 1);
    scale.oninput = () => this.handlers.setPlayerScale(parseFloat(scale.value));
    scale.ondblclick = () => {
      scale.value = '1';
      this.handlers.setPlayerScale(1);
    };
    scale.title = 'double-click to reset';
    scaleRow.append(scaleLabel, scale);
    wrap.appendChild(scaleRow);
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
      const scaleRow = div('bright-row');
      const lab = document.createElement('span');
      lab.className = 'bright-label';
      lab.textContent = 'Object scale';
      const rng = document.createElement('input');
      rng.type = 'range';
      rng.min = '0.2';
      rng.max = '5';
      rng.step = '0.1';
      rng.value = String(locus.object_scale ?? 1);
      rng.oninput = () => this.handlers.setObjectScale(locus.id, parseFloat(rng.value));
      rng.ondblclick = () => {
        rng.value = '1';
        this.handlers.setObjectScale(locus.id, 1);
      };
      rng.title = 'double-click to reset';
      scaleRow.append(lab, rng);
      wrap.appendChild(scaleRow);
    }

    // Rotation for a 3D mesh (images are camera-facing billboards, no rotation).
    // Slider + exact number box; double-click the slider to reset to 0.
    if (locus.mesh_3d) {
      const rot = locus.object_rotation ?? [0, 0, 0];
      ['Rotate X', 'Rotate Y', 'Rotate Z'].forEach((label, axis) => {
        const row = div('bright-row');
        const lab = document.createElement('span');
        lab.className = 'bright-label';
        lab.textContent = label;
        const num = document.createElement('input');
        num.type = 'number';
        num.className = 'rot-num';
        num.min = '-180';
        num.max = '180';
        num.step = '5';
        num.value = String(rot[axis]);
        const rng = document.createElement('input');
        rng.type = 'range';
        rng.min = '-180';
        rng.max = '180';
        rng.step = '5';
        rng.value = String(rot[axis]);
        const apply = (v: number) => {
          rng.value = String(v);
          num.value = String(v);
          this.handlers.setObjectRotation(locus.id, axis, v);
        };
        rng.oninput = () => apply(parseFloat(rng.value));
        num.oninput = () => apply(parseFloat(num.value) || 0);
        rng.ondblclick = () => apply(0);
        row.append(lab, rng, num);
        wrap.appendChild(row);
      });
    }

    return wrap;
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
    }
    return wrap;
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
