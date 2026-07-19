import { lociInOrder, type Palace } from '../model/palace';

/** Everything the panel needs to call back into the app. */
export interface EditorHandlers {
  renamePalace(name: string): void;
  enterWalk(): void;
  save(): void;
  load(): void;
  newPalace(): void;
  startReview(): void;
  selectLocus(id: string): void;
  updateLabel(id: string, text: string): void;
  updatePrompt(id: string, text: string): void;
  reorder(id: string, dir: -1 | 1): void;
  deleteLocus(id: string): void;
  teleport(id: string): void;
  undo(): void;
  redo(): void;
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

  // Kept so history state can be toggled without a full re-render (which would
  // drop focus while the user is mid-edit).
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;

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

  /** Update undo/redo enablement without re-rendering (preserves input focus). */
  setHistoryState(canUndo: boolean, canRedo: boolean): void {
    if (this.undoBtn) this.undoBtn.disabled = !canUndo;
    if (this.redoBtn) this.redoBtn.disabled = !canRedo;
  }

  render(palace: Palace, selectedId: string | null, canUndo = false, canRedo = false): void {
    this.rowLabels.clear();
    this.rowPrompts.clear();
    this.root.replaceChildren();

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
    name.setAttribute('aria-label', 'Palace name');
    name.oninput = () => this.handlers.renamePalace(name.value);
    header.appendChild(name);

    const actions = div('editor-actions');
    actions.appendChild(button('▶ Walk', 'primary', () => this.handlers.enterWalk()));
    actions.appendChild(button('Save', '', () => this.handlers.save()));
    actions.appendChild(button('Load', '', () => this.handlers.load()));
    actions.appendChild(button('New', '', () => this.handlers.newPalace()));
    const review = button('Review ▸', '', () => this.handlers.startReview());
    review.disabled = palace.loci.length === 0;
    actions.appendChild(review);

    this.undoBtn = button('↶', '', () => this.handlers.undo());
    this.undoBtn.title = 'Undo (Ctrl/Cmd+Z)';
    this.undoBtn.disabled = !canUndo;
    this.redoBtn = button('↷', '', () => this.handlers.redo());
    this.redoBtn.title = 'Redo (Ctrl/Cmd+Shift+Z)';
    this.redoBtn.disabled = !canRedo;
    actions.append(this.undoBtn, this.redoBtn);

    header.appendChild(actions);
    this.root.appendChild(header);

    const autosave = div('editor-autosave');
    autosave.textContent = '✓ Autosaves to this browser as you work · Save exports a .json backup';
    this.root.appendChild(autosave);

    // --- How-to hint -----------------------------------------------------------
    const hint = div('editor-hint');
    hint.innerHTML =
      palace.loci.length === 0
        ? 'No loci yet. Press <b>▶ Walk</b>, look at a wall or object, and press <kbd>E</kbd> to drop one.'
        : 'Click a locus to edit it. In walk mode: <kbd>E</kbd> drop · look at a marker then <kbd>X</kbd> delete / <kbd>G</kbd> move.';
    this.root.appendChild(hint);

    // --- Route list ------------------------------------------------------------
    const list = div('loci-list');
    const ordered = lociInOrder(palace);
    for (const locus of ordered) {
      const row = div('locus-row' + (locus.id === selectedId ? ' selected' : ''));

      const num = div('locus-num');
      num.textContent = String(locus.order);
      row.appendChild(num);

      const text = div('locus-text');
      const labelEl = div('locus-label');
      labelEl.textContent = locus.label || '(unlabeled location)';
      if (!locus.label) labelEl.classList.add('empty');
      const promptEl = div('locus-prompt');
      promptEl.textContent = locus.image_prompt || 'no mnemonic yet';
      if (!locus.image_prompt) promptEl.classList.add('empty');
      text.append(labelEl, promptEl);
      text.onclick = () => this.handlers.selectLocus(locus.id);
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
        list.appendChild(this.detail(locus.id, locus.label, locus.image_prompt));
      }
    }
    this.root.appendChild(list);

    // --- Controls reference ----------------------------------------------------
    const controls = div('editor-controls');
    controls.innerHTML = `
      <div class="ctrl-title">Controls</div>
      <div class="ctrl-grid">
        <span>Move</span><span>WASD / arrow keys</span>
        <span>Look</span><span>mouse</span>
        <span>Run</span><span>Shift</span>
        <span>Jump</span><span>Space</span>
        <span>Fly / no-clip</span><span>F <em>(fly = pass through walls)</em></span>
        <span>Fly up / down</span><span>Space / C (or Ctrl)</span>
        <span>Drop a locus</span><span>E</span>
        <span>Delete / move locus</span><span>X / G <em>(aim at a marker)</em></span>
        <span>Open locus editor</span><span>click a marker</span>
        <span>Back to this panel</span><span>Esc</span>
      </div>`;
    this.root.appendChild(controls);

    // --- Core-principle note ---------------------------------------------------
    const note = div('editor-note');
    note.innerHTML =
      'Write the mnemonic image yourself — the weirder the better. This tool renders your idea; it never invents one for you.';
    this.root.appendChild(note);
  }

  private detail(id: string, label: string, prompt: string): HTMLElement {
    const wrap = div('locus-detail');

    const lblField = field('Location cue', 'Where is it? e.g. "Kitchen island, north corner"');
    const lbl = lblField.input as HTMLInputElement;
    lbl.value = label;
    lbl.oninput = () => {
      this.handlers.updateLabel(id, lbl.value);
      const row = this.rowLabels.get(id);
      if (row) {
        row.textContent = lbl.value || '(unlabeled location)';
        row.classList.toggle('empty', !lbl.value);
      }
    };
    wrap.appendChild(lblField.el);

    const prField = field('Your mnemonic image', 'e.g. "a screaming lobster wearing my grandmother\'s reading glasses"', true);
    const pr = prField.input as HTMLTextAreaElement;
    pr.value = prompt;
    pr.oninput = () => {
      this.handlers.updatePrompt(id, pr.value);
      const row = this.rowPrompts.get(id);
      if (row) {
        row.textContent = pr.value || 'no mnemonic yet';
        row.classList.toggle('empty', !pr.value);
      }
    };
    wrap.appendChild(prField.el);

    return wrap;
  }
}

// --- tiny DOM helpers -------------------------------------------------------

function div(className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
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
