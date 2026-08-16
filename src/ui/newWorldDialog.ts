/**
 * "New world": pick the space a fresh palace starts in.
 *
 * Three ways in, deliberately side by side:
 *   • one of the built-in worlds (each shows the URL it lives at, so you can see
 *     that they're ordinary files, and copy one into a post or a palace of your own)
 *   • any GLB URL — someone else's published world, e.g. a file in a GitHub repo
 *   • a .glb from this computer (embedded in the palace, since it has no URL)
 *
 * Keeping the current space is also here, because "same room, fresh route" is the
 * most common reason to hit New at all.
 */
export interface WorldChoiceSample {
  id: string;
  label: string;
  sublabel: string;
  /** App-relative path actually loaded (works offline and on any deployment). */
  url: string;
  /** Canonical public URL, shown so people can share/reuse it. */
  publicUrl: string;
}

export type WorldChoice =
  | { kind: 'keep' }
  | { kind: 'sample'; id: string }
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: File };

export function chooseNewWorld(
  mount: HTMLElement,
  opts: { samples: WorldChoiceSample[]; canKeep: boolean },
): Promise<WorldChoice | null> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'settings-modal';
    const card = document.createElement('div');
    card.className = 'settings-card new-world-card';

    const finish = (choice: WorldChoice | null): void => {
      window.removeEventListener('keydown', onKey);
      root.remove();
      resolve(choice);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    };
    window.addEventListener('keydown', onKey);
    root.onclick = (e) => {
      if (e.target === root) finish(null);
    };

    const header = document.createElement('div');
    header.className = 'settings-header';
    const title = document.createElement('div');
    title.className = 'settings-title';
    title.textContent = 'New world';
    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.textContent = '✕';
    close.title = 'Cancel';
    close.onclick = () => finish(null);
    header.append(title, close);
    card.appendChild(header);

    if (opts.canKeep) {
      const keep = document.createElement('button');
      keep.className = 'choice-btn primary';
      keep.innerHTML = '<b>Keep this space</b><span>Same model, fresh empty route</span>';
      keep.onclick = () => finish({ kind: 'keep' });
      card.appendChild(keep);
    }

    const builtIn = document.createElement('div');
    builtIn.className = 'settings-section';
    builtIn.appendChild(sectionTitle('Built-in worlds'));
    for (const s of opts.samples) {
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.innerHTML =
        `<b>${escapeHtml(s.label)}</b><span>${escapeHtml(s.sublabel)}</span>` +
        `<code class="choice-url">${escapeHtml(s.publicUrl)}</code>`;
      b.onclick = () => finish({ kind: 'sample', id: s.id });
      builtIn.appendChild(b);
    }
    card.appendChild(builtIn);

    const own = document.createElement('div');
    own.className = 'settings-section';
    own.appendChild(sectionTitle('Your own world'));

    const urlRow = document.createElement('div');
    urlRow.className = 'settings-row';
    const url = document.createElement('input');
    url.type = 'url';
    url.className = 'world-url-input';
    url.placeholder = 'https://…/my-world.glb';
    url.autocomplete = 'off';
    const go = document.createElement('button');
    go.className = 'btn primary';
    go.textContent = 'Load URL';
    const submit = (): void => {
      const v = url.value.trim();
      if (v) finish({ kind: 'url', url: v });
    };
    go.onclick = submit;
    url.onkeydown = (e) => {
      if (e.key === 'Enter') submit();
    };
    urlRow.append(url, go);
    own.appendChild(urlRow);

    const urlHint = document.createElement('div');
    urlHint.className = 'settings-hint';
    urlHint.innerHTML =
      'Any <code>.glb</code> the browser can fetch. Publishing one in a <b>GitHub</b> repo works well — use the ' +
      '<code>raw.githubusercontent.com</code> link (GitHub Pages links work too). The palace stores the URL, so the ' +
      'file stays a few KB instead of megabytes.';
    own.appendChild(urlHint);

    const fileRow = document.createElement('div');
    fileRow.className = 'settings-row';
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.glb,.gltf,model/gltf-binary';
    picker.style.display = 'none';
    picker.onchange = () => {
      const f = picker.files?.[0];
      if (f) finish({ kind: 'file', file: f });
    };
    const upload = document.createElement('button');
    upload.className = 'btn';
    upload.textContent = '⬆ Upload a .glb';
    upload.onclick = () => picker.click();
    fileRow.append(upload, picker);
    own.appendChild(fileRow);

    const fileHint = document.createElement('div');
    fileHint.className = 'settings-hint';
    fileHint.textContent = 'An uploaded model is embedded in the palace (it has no URL to point at), so the file gets big.';
    own.appendChild(fileHint);

    card.appendChild(own);
    root.appendChild(card);
    mount.appendChild(root);
    (opts.canKeep ? card.querySelector<HTMLElement>('.choice-btn') : url)?.focus();
  });
}

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ctrl-title';
  el.textContent = text;
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
