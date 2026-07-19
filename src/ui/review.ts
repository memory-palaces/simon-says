/**
 * Review mode UI. The flow is intentionally spartan: teleport to a locus, show the
 * LOCATION cue, let the user try to recall the bizarre image they attached, then
 * reveal their own words to check. This is a recall test, so the mnemonic stays
 * hidden until the user asks for it.
 */
export class ReviewOverlay {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'review';
    this.body = document.createElement('div');
    this.body.className = 'review-card';
    this.root.appendChild(this.body);
    mount.appendChild(this.root);
    this.hide();
  }

  /** Step 1 for each locus: show the place, hide the mnemonic. */
  showCue(index: number, total: number, label: string): void {
    this.root.style.display = 'flex';
    this.body.innerHTML = `
      <div class="review-step">Locus ${index} of ${total}</div>
      <div class="review-cue">${escapeHtml(label || '(unlabeled location)')}</div>
      <div class="review-ask">What image did you place here?</div>
      <div class="review-hint"><kbd>Space</kbd> reveal &nbsp;·&nbsp; <kbd>Esc</kbd> exit</div>
    `;
  }

  /** Step 2: reveal the user's own mnemonic text. */
  showReveal(index: number, total: number, label: string, prompt: string, isLast: boolean): void {
    this.body.innerHTML = `
      <div class="review-step">Locus ${index} of ${total}</div>
      <div class="review-cue">${escapeHtml(label || '(unlabeled location)')}</div>
      <div class="review-reveal">${escapeHtml(prompt || '(no mnemonic written for this locus)')}</div>
      <div class="review-hint"><kbd>Space</kbd> ${isLast ? 'finish' : 'next locus'} &nbsp;·&nbsp; <kbd>Esc</kbd> exit</div>
    `;
  }

  showDone(count: number): void {
    this.body.innerHTML = `
      <div class="review-step">Review complete</div>
      <div class="review-cue">You walked ${count} ${count === 1 ? 'locus' : 'loci'}.</div>
      <div class="review-hint"><kbd>Space</kbd> or <kbd>Esc</kbd> back to editor</div>
    `;
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
