/**
 * The Assets library: a grid of every image / 3D model used in this world, with
 * the ability to download one or attach it to another element (a new decor, a
 * scene prop on a locus, or a portal's visual). Reuse without re-generating.
 */
import type { AssetRef } from '../model/assets';
import { downloadAsset } from './download';

export interface AssetHandlers {
  onAttach(asset: AssetRef): void;
  onReplace(asset: AssetRef): void;
  mountMeshPreview(container: HTMLElement, glbDataUrl: string): void;
  onClose?(): void;
}

export function openAssetManager(mount: HTMLElement, assets: AssetRef[], handlers: AssetHandlers): void {
  const root = document.createElement('div');
  root.className = 'settings-modal';

  const card = document.createElement('div');
  card.className = 'settings-card asset-card';
  root.appendChild(card);
  mount.appendChild(root);

  const close = (): void => {
    root.remove();
    window.removeEventListener('keydown', onKey);
    handlers.onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);
  root.onclick = (e) => {
    if (e.target === root) close();
  };

  const header = document.createElement('div');
  header.className = 'settings-header';
  header.innerHTML = `<div class="settings-title">Assets <span class="asset-count">${assets.length}</span></div>`;
  const x = document.createElement('button');
  x.className = 'icon-btn';
  x.textContent = '✕';
  x.title = 'Close';
  x.onclick = close;
  header.appendChild(x);
  card.appendChild(header);

  const note = document.createElement('div');
  note.className = 'settings-note';
  note.textContent = 'Everything you’ve rendered or uploaded in this world. Reuse one by attaching it elsewhere — no need to regenerate.';
  card.appendChild(note);

  const grid = document.createElement('div');
  grid.className = 'asset-grid';
  card.appendChild(grid);

  // One shared 3D preview (a single WebGL canvas) follows the mesh you hover.
  let showFirstMesh: (() => void) | null = null;

  for (const a of assets) {
    const cell = document.createElement('div');
    cell.className = 'asset-cell';

    const preview = document.createElement('div');
    preview.className = 'asset-preview';
    if (a.type === 'image') {
      const img = document.createElement('img');
      img.src = a.src;
      preview.appendChild(img);
    } else {
      // A "3D" poster behind a live orbit preview that appears on hover (the single
      // shared preview canvas moves to whichever mesh you point at).
      const badge = document.createElement('div');
      badge.className = 'asset-3d';
      badge.textContent = '3D · hover to spin';
      preview.appendChild(badge);
      const show = (): void => handlers.mountMeshPreview(preview, a.src);
      preview.addEventListener('mouseenter', show);
      if (!showFirstMesh) showFirstMesh = show;
    }
    cell.appendChild(preview);

    const meta = document.createElement('div');
    meta.className = 'asset-meta';
    meta.innerHTML = `<span class="asset-label">${escapeHtml(a.label)}</span><span class="asset-uses">used ${a.uses}×</span>`;
    cell.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'asset-actions';
    const attach = document.createElement('button');
    attach.className = 'btn primary';
    attach.textContent = 'Attach to…';
    attach.title = 'Reuse this asset on another element';
    attach.onclick = () => {
      close();
      handlers.onAttach(a);
    };
    const replace = document.createElement('button');
    replace.className = 'btn';
    replace.textContent = 'Replace…';
    replace.title = `Swap this asset for another everywhere it's used (${a.uses}×)`;
    replace.onclick = () => {
      close();
      handlers.onReplace(a);
    };
    const dl = document.createElement('button');
    dl.className = 'icon-btn';
    dl.textContent = '⬇';
    dl.title = 'Download this file';
    dl.onclick = () => downloadAsset(a.src, `asset-${a.type}`);
    actions.append(attach, replace, dl);
    cell.appendChild(actions);

    grid.appendChild(cell);
  }

  // Show one mesh live by default so the 3D preview is visible without hovering.
  showFirstMesh?.();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
