import type { Palace } from '../model/palace';

/**
 * A map of all worlds connected by portals — the whole project at a glance. Renders
 * the portal tree (root → each portal's target, recursively) as a clickable diagram;
 * clicking a world jumps you there. Toggled with 'M'.
 */
export class MapOverlay {
  private readonly root: HTMLElement;
  private open = false;
  private readonly onJump: (path: string[]) => void;

  constructor(mount: HTMLElement, onJump: (path: string[]) => void) {
    this.onJump = onJump;
    this.root = document.createElement('div');
    this.root.className = 'settings-modal';
    this.root.onclick = (e) => {
      if (e.target === this.root) this.hide();
    };
    mount.appendChild(this.root);
    this.hide();
  }

  toggle(rootPalace: Palace, currentPath: string[]): void {
    this.open ? this.hide() : this.show(rootPalace, currentPath);
  }

  private show(rootPalace: Palace, currentPath: string[]): void {
    this.open = true;
    const card = document.createElement('div');
    card.className = 'settings-card map-card';
    card.innerHTML = `
      <div class="settings-header">
        <div class="settings-title">World map</div>
        <button class="icon-btn map-close" title="Close">✕</button>
      </div>`;
    (card.querySelector('.map-close') as HTMLButtonElement).onclick = () => this.hide();

    const tree = document.createElement('div');
    tree.className = 'map-tree';
    tree.appendChild(this.renderWorld(rootPalace, [], 'root', currentPath));
    card.appendChild(tree);

    this.root.replaceChildren(card);
    this.root.style.display = 'flex';
  }

  private renderWorld(palace: Palace, path: string[], portalLabel: string, currentPath: string[]): HTMLElement {
    const node = document.createElement('div');
    node.className = 'map-node';

    const chip = document.createElement('button');
    chip.className = 'map-chip' + (this.samePath(path, currentPath) ? ' current' : '');
    const counts = `${palace.loci.length} loci${palace.portals?.length ? ` · ${palace.portals.length} portals` : ''}`;
    chip.innerHTML = `<span class="map-name">${escapeHtml(palace.name)}</span><span class="map-meta">${counts}</span>`;
    chip.onclick = () => this.onJump(path);
    node.appendChild(chip);

    const children = (palace.portals ?? []).filter((p) => p.target);
    if (children.length > 0) {
      const kids = document.createElement('div');
      kids.className = 'map-kids';
      for (const portal of children) {
        kids.appendChild(this.renderWorld(portal.target!, [...path, portal.id], portal.label || 'portal', currentPath));
      }
      node.appendChild(kids);
    }
    void portalLabel;
    return node;
  }

  private samePath(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }

  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
