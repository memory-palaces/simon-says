/** A small modal that asks the user to pick one of several actions. */
export interface Choice {
  id: string;
  label: string;
  sublabel?: string;
  variant?: 'primary';
}

/**
 * Show a choice modal and resolve with the chosen id (or null if cancelled via the
 * backdrop, Escape, or a choice whose id is 'cancel').
 */
export function chooseAction(
  mount: HTMLElement,
  opts: { title: string; message?: string; choices: Choice[] },
): Promise<string | null> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'choice-modal';

    const card = document.createElement('div');
    card.className = 'choice-card';

    const title = document.createElement('div');
    title.className = 'choice-title';
    title.textContent = opts.title;
    card.appendChild(title);

    if (opts.message) {
      const msg = document.createElement('div');
      msg.className = 'choice-msg';
      msg.textContent = opts.message;
      card.appendChild(msg);
    }

    const list = document.createElement('div');
    list.className = 'choice-list';

    const finish = (id: string | null): void => {
      window.removeEventListener('keydown', onKey);
      root.remove();
      resolve(id);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(null);
    };

    for (const c of opts.choices) {
      const btn = document.createElement('button');
      btn.className = 'choice-btn' + (c.variant === 'primary' ? ' primary' : '');
      const label = document.createElement('div');
      label.className = 'choice-btn-label';
      label.textContent = c.label;
      btn.appendChild(label);
      if (c.sublabel) {
        const sub = document.createElement('div');
        sub.className = 'choice-btn-sub';
        sub.textContent = c.sublabel;
        btn.appendChild(sub);
      }
      btn.onclick = () => finish(c.id === 'cancel' ? null : c.id);
      list.appendChild(btn);
    }

    card.appendChild(list);
    root.appendChild(card);
    root.onclick = (e) => {
      if (e.target === root) finish(null);
    };
    mount.appendChild(root);
    window.addEventListener('keydown', onKey);
  });
}
