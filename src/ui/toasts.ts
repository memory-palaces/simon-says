/**
 * Floating toast notifications + a retained activity log. Async work (especially
 * "Make 3D", which can take a while with no modal) needs feedback you can't scroll
 * past in the sidebar. show() returns a handle so a long op can start as "…" and
 * later resolve to success/error in place. Everything is also kept in a log the
 * user can open.
 */
export type ToastType = 'info' | 'success' | 'error';

export interface ToastHandle {
  update(message: string, type: ToastType): void;
  dismiss(): void;
}

interface LogEntry {
  message: string;
  type: ToastType;
  stamp: string;
}

export class Toasts {
  private readonly stack: HTMLElement;
  private readonly log: LogEntry[] = [];
  private logModal: HTMLElement | null = null;

  constructor(private readonly mount: HTMLElement) {
    this.stack = document.createElement('div');
    this.stack.className = 'toast-stack';
    mount.appendChild(this.stack);
  }

  /** Show a toast. Non-sticky info/success auto-dismiss; errors linger. */
  show(message: string, type: ToastType = 'info', opts: { sticky?: boolean } = {}): ToastHandle {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);
    this.stack.appendChild(el);
    this.record(message, type);

    let timer = 0;
    const scheduleDismiss = (t: ToastType) => {
      clearTimeout(timer);
      if (opts.sticky && t === 'info') return; // keep "…in progress" until updated
      const ms = t === 'error' ? 9000 : 3500;
      timer = window.setTimeout(() => dismiss(), ms);
    };
    const dismiss = () => {
      clearTimeout(timer);
      el.classList.add('leaving');
      window.setTimeout(() => el.remove(), 200);
    };
    el.onclick = dismiss;
    scheduleDismiss(type);

    return {
      update: (msg, t) => {
        text.textContent = msg;
        el.className = `toast ${t}`;
        this.record(msg, t);
        scheduleDismiss(t);
      },
      dismiss,
    };
  }

  info(message: string): ToastHandle {
    return this.show(message, 'info');
  }
  success(message: string): ToastHandle {
    return this.show(message, 'success');
  }
  error(message: string): ToastHandle {
    return this.show(message, 'error');
  }

  private record(message: string, type: ToastType): void {
    // Local wall-clock time; harmless here (this is the browser app, not a workflow).
    const now = new Date();
    const stamp = now.toTimeString().slice(0, 8);
    this.log.push({ message, type, stamp });
    if (this.log.length > 200) this.log.shift();
    if (this.logModal) this.renderLog();
  }

  /** Open a modal listing the activity log (newest first). */
  openLog(): void {
    if (this.logModal) return;
    const root = document.createElement('div');
    root.className = 'settings-modal';
    root.onclick = (e) => {
      if (e.target === root) this.closeLog();
    };
    const card = document.createElement('div');
    card.className = 'settings-card';
    card.innerHTML = `
      <div class="settings-header">
        <div class="settings-title">Activity log</div>
        <button class="icon-btn log-close" title="Close">✕</button>
      </div>
      <div class="log-list"></div>`;
    (card.querySelector('.log-close') as HTMLButtonElement).onclick = () => this.closeLog();
    root.appendChild(card);
    this.mount.appendChild(root);
    this.logModal = root;
    this.renderLog();
  }

  private closeLog(): void {
    this.logModal?.remove();
    this.logModal = null;
  }

  private renderLog(): void {
    const list = this.logModal?.querySelector('.log-list');
    if (!list) return;
    if (this.log.length === 0) {
      list.innerHTML = '<div class="log-empty">Nothing yet.</div>';
      return;
    }
    list.replaceChildren(
      ...[...this.log].reverse().map((e) => {
        const row = document.createElement('div');
        row.className = `log-row ${e.type}`;
        row.innerHTML = `<span class="log-time">${e.stamp}</span><span>${escapeHtml(e.message)}</span>`;
        return row;
      }),
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
