/**
 * First-run guide: what this is, the usual workflow, and the handful of keys you
 * must know (above all: Esc brings the menu back). Shown automatically on startup
 * until the user unticks "show on startup"; always reachable from the 📖 Guide
 * button in the editor. Reuses the settings-modal styling so it feels native.
 */
const SEEN_KEY = 'simon-says:welcome:v1';
const REPO_URL = 'https://github.com/memory-palaces/simon-says';

export class WelcomeDialog {
  private readonly root: HTMLElement;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'settings-modal';
    this.root.onclick = (e) => {
      if (e.target === this.root) this.hide();
    };
    mount.appendChild(this.root);
    this.hide();
  }

  /** True when the user hasn't opted out — call on boot. */
  static wantedOnStartup(): boolean {
    try {
      return localStorage.getItem(SEEN_KEY) !== 'off';
    } catch {
      return true;
    }
  }

  private static setOnStartup(on: boolean): void {
    try {
      if (on) localStorage.removeItem(SEEN_KEY);
      else localStorage.setItem(SEEN_KEY, 'off');
    } catch {
      /* ignore */
    }
  }

  isOpen(): boolean {
    return this.root.style.display !== 'none';
  }

  open(): void {
    const card = document.createElement('div');
    card.className = 'settings-card welcome-card';
    card.innerHTML = `
      <div class="settings-header">
        <div class="settings-title">Welcome to Simon Says</div>
        <button class="icon-btn" title="Close" data-close>✕</button>
      </div>
      <p class="welcome-lead">
        A <b>memory palace</b> builder you walk through in first person. Pin numbered
        <b>loci</b> onto a 3D space, attach a bizarre image to each, then let it quiz you.
        Everything stays in this browser — no account, nothing uploaded.
      </p>

      <div class="settings-section">
        <div class="ctrl-title">The usual flow</div>
        <ol class="welcome-steps">
          <li><b>▶ Enter</b> the sample space (or drag your own <code>.glb</code> onto the window).</li>
          <li>Walk to a spot you'll remember, aim, press <kbd>T</kbd> to drop a locus.</li>
          <li>Press <kbd>Esc</kbd> to come back here and write the mnemonic for it in the sidebar.</li>
          <li>Optional: render the image with AI — <b>⚙ Settings</b>, paste a key from
              <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noopener">fal.ai</a>
              (sign up there; pay-per-image), or point at a local ComfyUI.</li>
          <li><b>Review ▸</b> walks the route and quizzes you. <b>Save</b> writes a <code>.json</code> you own.</li>
        </ol>
      </div>

      <div class="settings-section">
        <div class="ctrl-title">Keys you actually need</div>
        <div class="ctrl-grid welcome-keys">
          <span>Back to this menu</span><span><kbd>Esc</kbd> <em>(the only way out — remember it!)</em></span>
          <span>Move / look</span><span><kbd>W A S D</kbd> + mouse · <kbd>Shift</kbd> run</span>
          <span>Drop a locus</span><span><kbd>T</kbd> <em>(aim first)</em></span>
          <span>Fly through walls</span><span><kbd>F</kbd> · <kbd>Space</kbd>/<kbd>C</kbd> up/down</span>
          <span>Recenter on locus #1</span><span><kbd>R</kbd></span>
          <span>Save</span><span><kbd>Ctrl/Cmd</kbd>+<kbd>S</kbd></span>
          <span>Every other key</span><span><kbd>?</kbd> shows the full cheat-sheet</span>
        </div>
      </div>

      <p class="settings-hint welcome-more">
        Portals between spaces, world map, local ComfyUI, desktop app, Docker, bringing your
        own 3D scans — see the <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub page</a>.
      </p>

      <div class="welcome-footer">
        <label class="welcome-toggle">
          <input type="checkbox" data-startup ${WelcomeDialog.wantedOnStartup() ? 'checked' : ''}>
          Show this on startup
        </label>
        <button class="btn primary" data-close>Got it</button>
      </div>`;
    const startup = card.querySelector<HTMLInputElement>('[data-startup]')!;
    startup.onchange = () => WelcomeDialog.setOnStartup(startup.checked);
    card.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) => (b.onclick = () => this.hide()));
    this.root.replaceChildren(card);
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }
}
