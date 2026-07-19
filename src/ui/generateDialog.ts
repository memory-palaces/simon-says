/**
 * The generate → preview → approve/reroll modal. The prompt is shown read-only:
 * this dialog renders the user's words, it never offers to change them. The caller
 * supplies a `generate(seed)` function (the active backend) and receives the
 * approved image; the dialog owns the reroll seed and the busy state.
 */
export interface GenerateHandlers {
  generate(seed: number): Promise<string>;
  onApprove(dataUrl: string): void;
}

export class GenerateDialog {
  private readonly root: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly rerollBtn: HTMLButtonElement;
  private readonly approveBtn: HTMLButtonElement;

  private handlers: GenerateHandlers | null = null;
  private seed = 0;
  private current: string | null = null;
  private busy = false;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'gen-modal';
    this.root.innerHTML = `
      <div class="gen-card">
        <div class="gen-title">Render your mnemonic image</div>
        <div class="gen-prompt"></div>
        <div class="gen-stage"></div>
        <div class="gen-actions">
          <button class="btn gen-reroll">↻ Reroll</button>
          <button class="btn gen-cancel">Cancel</button>
          <button class="btn primary gen-approve">Use this image</button>
        </div>
      </div>`;
    mount.appendChild(this.root);

    this.promptEl = this.root.querySelector('.gen-prompt')!;
    this.stage = this.root.querySelector('.gen-stage')!;
    this.rerollBtn = this.root.querySelector('.gen-reroll')!;
    this.approveBtn = this.root.querySelector('.gen-approve')!;

    this.rerollBtn.onclick = () => this.run(this.seed + 1);
    this.approveBtn.onclick = () => this.approve();
    (this.root.querySelector('.gen-cancel') as HTMLButtonElement).onclick = () => this.close();
    this.root.onclick = (e) => {
      if (e.target === this.root) this.close();
    };
    this.hide();
  }

  open(prompt: string, handlers: GenerateHandlers): void {
    this.handlers = handlers;
    this.promptEl.textContent = `“${prompt}”`;
    this.seed = 0;
    this.current = null;
    this.root.style.display = 'flex';
    this.run(0);
  }

  private async run(seed: number): Promise<void> {
    if (!this.handlers || this.busy) return;
    this.seed = seed;
    this.busy = true;
    this.setButtons();
    this.stage.innerHTML = '<div class="gen-loading">Rendering…</div>';
    try {
      const dataUrl = await this.handlers.generate(seed);
      this.current = dataUrl;
      const img = document.createElement('img');
      img.className = 'gen-image';
      img.src = dataUrl;
      this.stage.replaceChildren(img);
    } catch (err) {
      console.error(err);
      this.current = null;
      this.stage.innerHTML = '<div class="gen-error">Generation failed. Check the backend and try again.</div>';
    } finally {
      this.busy = false;
      this.setButtons();
    }
  }

  private approve(): void {
    if (!this.current || !this.handlers) return;
    this.handlers.onApprove(this.current);
    this.close();
  }

  private setButtons(): void {
    this.rerollBtn.disabled = this.busy;
    this.approveBtn.disabled = this.busy || !this.current;
  }

  private close(): void {
    this.handlers = null;
    this.hide();
  }

  private hide(): void {
    this.root.style.display = 'none';
    this.stage.replaceChildren();
  }
}
