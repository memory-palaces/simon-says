/**
 * Review mode UI. Recall test: fly to a locus, show only the LOCATION, and let the
 * user try to recall the bizarre image they placed before revealing it. The
 * mnemonic stays hidden until they ask for it. Prev / Next / Reveal are prominent
 * buttons (also Space = reveal-then-next, ← / → = prev/next, Esc = exit).
 */
export interface ReviewHandlers {
  reveal(): void;
  prev(): void;
  next(): void;
  exit(): void;
}

export class ReviewOverlay {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly handlers: ReviewHandlers;

  constructor(mount: HTMLElement, handlers: ReviewHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.className = 'review';
    this.body = document.createElement('div');
    this.body.className = 'review-card';
    this.root.appendChild(this.body);
    mount.appendChild(this.root);
    this.hide();
  }

  /** Step 1 for each locus: show the place, keep the mnemonic hidden. */
  showCue(index: number, total: number, label: string): void {
    this.root.style.display = 'flex';
    this.body.replaceChildren();
    this.body.appendChild(stepEl(index, total));
    this.body.appendChild(cueEl(label));

    const actions = row('review-actions');
    actions.append(
      navBtn('◀', 'Previous (←)', index <= 1, () => this.handlers.prev()),
      bigBtn('Reveal', 'review-reveal', () => this.handlers.reveal()),
      navBtn('▶', 'Next (→)', false, () => this.handlers.next()),
    );
    this.body.appendChild(actions);
    this.body.appendChild(this.exitRow());
  }

  /** Step 2: reveal the user's own mnemonic text. */
  showReveal(index: number, total: number, label: string, prompt: string, isLast: boolean): void {
    this.body.replaceChildren();
    this.body.appendChild(stepEl(index, total));
    this.body.appendChild(cueEl(label));

    const reveal = document.createElement('div');
    reveal.className = 'review-reveal-text';
    reveal.textContent = prompt || '(no mnemonic written for this locus)';
    this.body.appendChild(reveal);

    const actions = row('review-actions');
    actions.append(
      navBtn('◀ Prev', 'Previous (←)', index <= 1, () => this.handlers.prev()),
      bigBtn(isLast ? 'Finish ▸' : 'Next ▶', 'review-next', () => this.handlers.next()),
    );
    this.body.appendChild(actions);
    this.body.appendChild(this.exitRow());
  }

  showDone(count: number): void {
    this.body.replaceChildren();
    this.body.appendChild(stepEl(0, 0, 'Review complete'));
    this.body.appendChild(cueEl(`You walked ${count} ${count === 1 ? 'locus' : 'loci'}.`));
    const actions = row('review-actions');
    actions.append(
      navBtn('◀ Back', 'Previous (←)', false, () => this.handlers.prev()),
      bigBtn('Done ▸', 'review-next', () => this.handlers.exit()),
    );
    this.body.appendChild(actions);
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  private exitRow(): HTMLElement {
    const r = row('review-exit');
    const b = document.createElement('button');
    b.className = 'review-exit-btn';
    b.textContent = 'Exit review (Esc)';
    b.onclick = () => this.handlers.exit();
    r.appendChild(b);
    return r;
  }
}

function stepEl(index: number, total: number, override?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'review-step';
  el.textContent = override ?? `Locus ${index} of ${total}`;
  return el;
}

function cueEl(label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'review-cue';
  el.textContent = label || '(unlabeled location)';
  return el;
}

function row(className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function bigBtn(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `review-big ${className}`;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function navBtn(text: string, title: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'review-nav';
  b.textContent = text;
  b.title = title;
  b.disabled = disabled;
  b.onclick = onClick;
  return b;
}
