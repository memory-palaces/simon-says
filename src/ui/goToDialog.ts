/**
 * Editor-style "go to" (Ctrl/Cmd+G): a small palette that lists the loci and jumps
 * to one. Type a number and press Enter, or click a row. Filtering also matches the
 * location label so you can jump by name.
 */
export interface GoToItem {
  id: string;
  order: number;
  label: string;
}

export function openGoToDialog(mount: HTMLElement, items: GoToItem[], onGo: (id: string) => void): void {
  const root = document.createElement('div');
  root.className = 'settings-modal';

  const card = document.createElement('div');
  card.className = 'goto-card';
  card.innerHTML = `
    <input class="goto-input" type="text" placeholder="Go to # or name…" autocomplete="off" />
    <div class="goto-list"></div>`;
  root.appendChild(card);
  mount.appendChild(root);

  const input = card.querySelector('.goto-input') as HTMLInputElement;
  const list = card.querySelector('.goto-list') as HTMLElement;

  const close = (): void => {
    window.removeEventListener('keydown', onKey, true);
    root.remove();
  };
  const go = (id: string): void => {
    close();
    onGo(id);
  };

  const render = (): void => {
    const q = input.value.trim().toLowerCase();
    const matches = items.filter((it) => !q || String(it.order) === q || it.label.toLowerCase().includes(q));
    list.replaceChildren(
      ...matches.map((it) => {
        const row = document.createElement('div');
        row.className = 'goto-row';
        row.innerHTML = `<span class="goto-num">${it.order}</span><span>${escapeHtml(it.label || '(unlabeled)')}</span>`;
        row.onclick = () => go(it.id);
        return row;
      }),
    );
  };

  input.oninput = render;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      // Prefer an exact number; otherwise the first filtered match.
      const q = input.value.trim().toLowerCase();
      const exact = items.find((it) => String(it.order) === q);
      const first = items.find((it) => !q || String(it.order) === q || it.label.toLowerCase().includes(q));
      const pick = exact ?? first;
      if (pick) go(pick.id);
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  root.onclick = (e) => {
    if (e.target === root) close();
  };

  render();
  input.focus();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
