/** A dismissible controls cheat-sheet, toggled with '?' from anywhere. */
export class HelpOverlay {
  private readonly root: HTMLElement;
  private open = false;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'settings-modal';
    this.root.onclick = (e) => {
      if (e.target === this.root) this.hide();
    };
    this.root.innerHTML = `
      <div class="settings-card">
        <div class="settings-header">
          <div class="settings-title">Controls</div>
          <button class="icon-btn help-close" title="Close">✕</button>
        </div>
        <div class="ctrl-grid">
          <span>Move</span><span>WASD / arrow keys</span>
          <span>Look around</span><span>mouse (right-click / Esc releases)</span>
          <span>Run</span><span>Shift</span>
          <span>Jump</span><span>Space</span>
          <span>Fly ⇄ walk</span><span>F <em>(fly = pass through walls)</em></span>
          <span>Fly up / down</span><span>Space / C</span>
          <span>Zoom (dolly)</span><span>mouse wheel</span>
          <span>Recenter on floor</span><span>R</span>
          <span>X-ray all pins</span><span>X</span>
          <span>Drop a locus</span><span>T</span>
          <span>Move a locus</span><span>G <em>(aim at a marker)</em></span>
          <span>Delete a locus</span><span>B <em>(aim at a marker)</em></span>
          <span>Drop a portal</span><span>P</span>
          <span>Go through a portal</span><span>Enter <em>(aim at a portal)</em></span>
          <span>Return to parent world</span><span>Q</span>
          <span>Previous / next locus</span><span>[ / ]</span>
          <span>Go to a locus</span><span>Ctrl/Cmd+G</span>
          <span>Undo / redo</span><span>Ctrl/Cmd+Z / +Shift+Z</span>
          <span>Save</span><span>Ctrl/Cmd+S</span>
          <span>This help</span><span>?</span>
        </div>
      </div>`;
    (this.root.querySelector('.help-close') as HTMLButtonElement).onclick = () => this.hide();
    mount.appendChild(this.root);
    this.hide();
  }

  toggle(): void {
    this.open ? this.hide() : this.show();
  }
  show(): void {
    this.open = true;
    this.root.style.display = 'flex';
  }
  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
  }
}
