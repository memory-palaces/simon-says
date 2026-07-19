/**
 * The generate → preview → approve/reroll modal, with session history. AI image
 * gen is famous for "you'll never see that iteration again", so every render is
 * kept in a variants list you can page through (◀ ▶); Reroll appends a new one.
 * The prompt is shown read-only — this dialog renders the user's words, never
 * edits them.
 */
export interface GenerateHandlers {
  /** Existing images for this locus (session history), oldest first. Mutated in place. */
  variants: string[];
  generate(seed: number): Promise<string>;
  onGenerated(dataUrl: string): void;
  onApprove(dataUrl: string): void;
}

export class GenerateDialog {
  private readonly root: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly rerollBtn: HTMLButtonElement;
  private readonly approveBtn: HTMLButtonElement;

  private handlers: GenerateHandlers | null = null;
  private index = -1;
  private seed = 0;
  private busy = false;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'gen-modal';
    this.root.innerHTML = `
      <div class="gen-card">
        <div class="gen-title">Render your mnemonic image</div>
        <div class="gen-prompt"></div>
        <div class="gen-stage"></div>
        <div class="gen-nav">
          <button class="btn gen-prev">◀</button>
          <span class="gen-counter"></span>
          <button class="btn gen-next">▶</button>
        </div>
        <div class="gen-actions">
          <button class="btn gen-reroll">↻ Reroll</button>
          <button class="btn gen-cancel">Cancel</button>
          <button class="btn primary gen-approve">Use this image</button>
        </div>
      </div>`;
    mount.appendChild(this.root);

    this.promptEl = this.root.querySelector('.gen-prompt')!;
    this.stage = this.root.querySelector('.gen-stage')!;
    this.counter = this.root.querySelector('.gen-counter')!;
    this.prevBtn = this.root.querySelector('.gen-prev')!;
    this.nextBtn = this.root.querySelector('.gen-next')!;
    this.rerollBtn = this.root.querySelector('.gen-reroll')!;
    this.approveBtn = this.root.querySelector('.gen-approve')!;

    this.prevBtn.onclick = () => this.step(-1);
    this.nextBtn.onclick = () => this.step(1);
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
    this.seed = handlers.variants.length;
    this.root.style.display = 'flex';
    if (handlers.variants.length > 0) {
      this.index = handlers.variants.length - 1; // show the most recent
      this.showCurrent();
    } else {
      this.run(0); // nothing yet — render one
    }
  }

  private get variants(): string[] {
    return this.handlers?.variants ?? [];
  }

  private async run(seed: number): Promise<void> {
    if (!this.handlers || this.busy) return;
    this.seed = seed;
    this.busy = true;
    this.stage.innerHTML = '<div class="gen-loading">Rendering…</div>';
    this.setButtons();
    try {
      const dataUrl = await this.handlers.generate(seed);
      this.handlers.onGenerated(dataUrl); // append to session history
      this.index = this.variants.length - 1;
      this.showCurrent();
    } catch (err) {
      console.error(err);
      this.stage.innerHTML = '<div class="gen-error">Generation failed. Check the pipeline in Settings and try again.</div>';
    } finally {
      this.busy = false;
      this.setButtons();
    }
  }

  private step(delta: number): void {
    const next = this.index + delta;
    if (next < 0 || next >= this.variants.length) return;
    this.index = next;
    this.showCurrent();
  }

  private showCurrent(): void {
    const src = this.variants[this.index];
    if (src) {
      const img = document.createElement('img');
      img.className = 'gen-image';
      img.src = src;
      this.stage.replaceChildren(img);
    }
    this.setButtons();
  }

  private approve(): void {
    const src = this.variants[this.index];
    if (!src || !this.handlers) return;
    this.handlers.onApprove(src);
    this.close();
  }

  private setButtons(): void {
    const total = this.variants.length;
    this.counter.textContent = total > 0 ? `${this.index + 1} / ${total}` : '';
    this.prevBtn.disabled = this.busy || this.index <= 0;
    this.nextBtn.disabled = this.busy || this.index >= total - 1;
    this.rerollBtn.disabled = this.busy;
    this.approveBtn.disabled = this.busy || total === 0;
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
