import {
  DEFAULT_FAL_MODEL,
  DEFAULT_LOCAL_URL,
  DEFAULT_LOCAL_WORKFLOW,
  type FalConfig,
  type LocalConfig,
} from '../model/generation';

/**
 * App-global settings, opened from the gear. Holds things that are NOT specific to
 * one world: generation credentials (a fal.ai key, a ComfyUI endpoint + workflow)
 * and the controls reference. Which pipeline a world USES is chosen per-world in
 * the editor; the keys/endpoints that power those pipelines live here.
 */
export interface SettingsHandlers {
  setFalConfig(apiKey: string, model: string): void;
  setLocalConfig(url: string, workflow: string): void;
  testLocal(): Promise<string>;
}

export class SettingsDialog {
  private readonly root: HTMLElement;
  private readonly handlers: SettingsHandlers;

  constructor(mount: HTMLElement, handlers: SettingsHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.className = 'settings-modal';
    this.root.onclick = (e) => {
      if (e.target === this.root) this.hide();
    };
    mount.appendChild(this.root);
    this.hide();
  }

  open(config: { local?: LocalConfig; fal?: FalConfig }): void {
    this.root.replaceChildren(this.buildCard(config));
    this.root.style.display = 'flex';
  }

  private hide(): void {
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  private buildCard(config: { local?: LocalConfig; fal?: FalConfig }): HTMLElement {
    const card = div('settings-card');

    const header = div('settings-header');
    const title = div('settings-title');
    title.textContent = 'Settings';
    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.textContent = '✕';
    close.title = 'Close';
    close.onclick = () => this.hide();
    header.append(title, close);
    card.appendChild(header);

    card.appendChild(this.generationCreds(config));
    card.appendChild(this.controlsReference());
    return card;
  }

  private generationCreds(config: { local?: LocalConfig; fal?: FalConfig }): HTMLElement {
    const wrap = div('settings-section');
    wrap.appendChild(sectionTitle('Image generation — keys & endpoints'));
    const note = div('settings-note');
    note.textContent = 'Configured once and shared across worlds. Each world picks which of these to use.';
    wrap.appendChild(note);

    // fal.ai
    const falKey = field('fal.ai API key', 'paste your key');
    (falKey.input as HTMLInputElement).type = 'password';
    (falKey.input as HTMLInputElement).autocomplete = 'off';
    falKey.input.value = config.fal?.apiKey ?? '';
    // The model is chosen per-world on the sidebar, so only the key lives here; keep
    // whatever model was already set when saving the key.
    const saveFal = () => this.handlers.setFalConfig((falKey.input as HTMLInputElement).value, config.fal?.model ?? DEFAULT_FAL_MODEL);
    falKey.input.oninput = saveFal;
    wrap.append(falKey.el);
    const falHint = div('settings-hint');
    falHint.innerHTML = 'Key from <code>fal.ai/dashboard/keys</code>. Stored in this browser; sent only to fal.ai. Pick the model per world on the sidebar.';
    wrap.appendChild(falHint);

    // Local ComfyUI
    const url = field('ComfyUI URL', DEFAULT_LOCAL_URL);
    url.input.value = config.local?.url ?? DEFAULT_LOCAL_URL;
    const wf = field('ComfyUI workflow (API format — keep {PROMPT} and {SEED})', '');
    const wfArea = wf.input as HTMLTextAreaElement;
    wfArea.value = config.local?.imageWorkflow ?? DEFAULT_LOCAL_WORKFLOW;
    wfArea.rows = 6;
    wfArea.spellcheck = false;
    const saveLocal = () => this.handlers.setLocalConfig((url.input as HTMLInputElement).value, wfArea.value);
    url.input.oninput = saveLocal;
    wfArea.oninput = saveLocal;
    wrap.append(url.el, wf.el);

    const testRow = div('settings-row');
    const status = div('settings-status');
    const test = document.createElement('button');
    test.className = 'btn';
    test.textContent = 'Test connection';
    test.onclick = async () => {
      status.textContent = 'Testing…';
      status.className = 'settings-status';
      const result = await this.handlers.testLocal();
      status.textContent = result;
    };
    testRow.append(test, status);
    wrap.appendChild(testRow);
    const localHint = div('settings-hint');
    localHint.innerHTML = 'Start ComfyUI with <code>--enable-cors-header "*"</code> and set <code>ckpt_name</code> to a checkpoint you have.';
    wrap.appendChild(localHint);

    return wrap;
  }

  private controlsReference(): HTMLElement {
    const wrap = div('settings-section');
    wrap.appendChild(sectionTitle('Controls'));
    const grid = div('ctrl-grid');
    grid.innerHTML = `
      <span>Move</span><span>WASD / arrow keys</span>
      <span>Look</span><span>mouse</span>
      <span>Run</span><span>Shift</span>
      <span>Jump</span><span>Space</span>
      <span>Fly / no-clip</span><span>F <em>(fly = pass through walls)</em></span>
      <span>Fly up / down</span><span>Space / C</span>
      <span>Fly ⇄ walk (gravity)</span><span>F</span>
      <span>Drop a locus</span><span>T</span>
      <span>Delete / move locus</span><span>B / G <em>(aim at a marker)</em></span>
      <span>Recenter on floor</span><span>R</span>
      <span>X-ray (all pins through walls)</span><span>X</span>
      <span>Show controls help</span><span>?</span>
      <span>Drop a portal</span><span>P</span>
      <span>Go through a portal (aim at it)</span><span>Enter</span>
      <span>Return to parent world</span><span>Q</span>
      <span>Open locus editor</span><span>click a marker</span>
      <span>Undo / redo</span><span>Ctrl/Cmd+Z / +Shift+Z</span>
      <span>Previous / next locus</span><span>[ / ]</span>
      <span>Go to a locus</span><span>Ctrl/Cmd+G</span>
      <span>Back to editor</span><span>Esc</span>`;
    wrap.appendChild(grid);
    return wrap;
  }
}

// --- helpers ----------------------------------------------------------------

function div(className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function sectionTitle(text: string): HTMLElement {
  const el = div('ctrl-title');
  el.textContent = text;
  return el;
}

function field(labelText: string, placeholder: string): { el: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const el = div('field');
  const lab = document.createElement('label');
  lab.textContent = labelText;
  const multiline = /workflow/i.test(labelText);
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.setAttribute('placeholder', placeholder);
  if (!multiline) (input as HTMLInputElement).type = 'text';
  lab.appendChild(input);
  el.appendChild(lab);
  return { el, input: input as HTMLInputElement | HTMLTextAreaElement };
}
