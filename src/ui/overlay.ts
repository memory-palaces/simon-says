/**
 * Minimal DOM overlay: a start/pause panel, a loading/error state, a crosshair and
 * a bottom-left HUD. Kept as plain DOM (no framework) so hobbyists can read it.
 */
export class Overlay {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly panelBody: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly crosshair: HTMLElement;

  onResume: (() => void) | null = null;

  constructor(mount: HTMLElement) {
    this.root = el('div', 'overlay interactive');
    this.panel = el('div', 'panel');
    this.panelBody = el('div', '');
    this.panel.appendChild(this.panelBody);
    this.root.appendChild(this.panel);

    this.crosshair = el('div', 'crosshair');
    this.hud = el('div', 'hud');

    mount.appendChild(this.crosshair);
    mount.appendChild(this.hud);
    mount.appendChild(this.root);
  }

  showLoading(name: string): void {
    this.setInteractive(true);
    this.panelBody.innerHTML = `<h1>Memory Palace</h1><p class="loading">Loading ${escapeHtml(name)}…</p>`;
  }

  showError(message: string): void {
    this.setInteractive(true);
    this.panelBody.innerHTML =
      `<h1>Memory Palace</h1><p class="error">${escapeHtml(message)}</p>` +
      `<p>Drag a <code>.glb</code> or <code>.gltf</code> file onto the window to try another space.</p>`;
  }

  /** The "click to enter" state shown before pointer lock and after Esc. */
  showStart(spaceName: string): void {
    this.setInteractive(true);
    this.panelBody.innerHTML = `
      <h1>Memory Palace</h1>
      <p>Walking <b>${escapeHtml(spaceName)}</b></p>
      <div class="keys">
        <kbd>W</kbd><span>forward</span>
        <kbd>A</kbd><span>strafe left</span>
        <kbd>S</kbd><span>back</span>
        <kbd>D</kbd><span>strafe right</span>
        <kbd>Shift</kbd><span>run</span>
        <kbd>Mouse</kbd><span>look around</span>
        <kbd>Esc</kbd><span>release cursor</span>
      </div>
      <p class="hint">Click to enter</p>
      <p style="margin-top:14px">Drag any <code>.glb</code> / <code>.gltf</code> onto the window to walk your own space.</p>
    `;
    // A click anywhere on the panel resumes.
    this.panel.onclick = () => this.onResume?.();
  }

  hide(): void {
    this.setInteractive(false);
    this.panelBody.innerHTML = '';
    this.panel.onclick = null;
  }

  setCrosshair(visible: boolean): void {
    this.crosshair.classList.toggle('visible', visible);
  }

  setHud(text: string): void {
    this.hud.textContent = text;
  }

  private setInteractive(on: boolean): void {
    this.root.style.display = on ? 'flex' : 'none';
    this.root.classList.toggle('interactive', on);
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}
