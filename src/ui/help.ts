/**
 * A controls cheat-sheet toggled with '?'. It docks to the side as a
 * non-blocking reference (pointer-events off), so you can leave it up and keep
 * walking around — it never steals the pointer lock or dims the scene.
 */
export class HelpOverlay {
  private readonly root: HTMLElement;
  private open = false;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'help-panel';
    this.root.innerHTML = `
      <div class="help-title">Controls <span class="help-hint">? to hide</span></div>
      <div class="ctrl-grid">
        <span>Move</span><span>WASD / arrows</span>
        <span>Look around</span><span>mouse <em>(right-click / Esc releases)</em></span>
        <span>Run</span><span>Shift</span>
        <span>Jump</span><span>Space</span>
        <span>Fly ⇄ walk</span><span>F <em>(fly = through walls; F in the air = fall)</em></span>
        <span>Fly up / down</span><span>Space / C</span>
        <span>Zoom (dolly)</span><span>mouse wheel or { / }</span>
        <span>Recenter on #1</span><span>R</span>
        <span>X-ray all pins</span><span>X</span>
        <span>Drop a locus</span><span>T</span>
        <span>Move a locus</span><span>G <em>(aim at a marker)</em></span>
        <span>Delete a locus</span><span>B <em>(aim at a marker)</em></span>
        <span>Drop a portal</span><span>P</span>
        <span>Go through a portal</span><span>Enter <em>(aim at a portal)</em></span>
        <span>Return to parent world</span><span>Q</span>
        <span>Previous / next locus</span><span>[ / ]</span>
        <span>Go to a locus / portal</span><span>Ctrl/Cmd+G</span>
        <span>Undo / redo</span><span>Ctrl/Cmd+Z / +Shift+Z</span>
        <span>Save</span><span>Ctrl/Cmd+S</span>
        <span>Bird’s-eye view</span><span>V <em>(ring marks where you'd land — click it)</em></span>
        <span>World map</span><span>M</span>
        <span>This help</span><span>?</span>
      </div>`;
    mount.appendChild(this.root);
    this.hide();
  }

  toggle(): void {
    this.open ? this.hide() : this.show();
  }
  show(): void {
    this.open = true;
    this.root.style.display = 'block';
  }
  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
  }
}
