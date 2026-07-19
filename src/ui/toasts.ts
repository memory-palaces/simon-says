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
  private drawer: HTMLElement | null = null;

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
    const entry: LogEntry = { message, type, stamp };
    this.log.push(entry);
    if (this.log.length > 400) this.log.shift();
    if (this.drawer) this.appendRow(entry, true);
  }

  /** Toggle a docked, non-blocking console drawer at the bottom (devtools-style). */
  openLog(): void {
    if (this.drawer) {
      this.closeLog();
      return;
    }
    const drawer = document.createElement('div');
    drawer.className = 'console-drawer';
    drawer.innerHTML = `
      <div class="console-head">
        <span class="console-title">Console</span>
        <button class="icon-btn console-close" title="Close">✕</button>
      </div>
      <div class="console-list"></div>`;
    (drawer.querySelector('.console-close') as HTMLButtonElement).onclick = () => this.closeLog();
    this.mount.appendChild(drawer);
    this.drawer = drawer;
    for (const entry of this.log) this.appendRow(entry, false);
    this.scrollLog();
  }

  private closeLog(): void {
    this.drawer?.remove();
    this.drawer = null;
  }

  private appendRow(entry: LogEntry, autoscroll: boolean): void {
    const list = this.drawer?.querySelector('.console-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = `log-row ${entry.type}`;
    row.innerHTML = `<span class="log-time">${entry.stamp}</span><span>${escapeHtml(entry.message)}</span>`;
    list.appendChild(row);
    if (autoscroll) this.scrollLog();
  }

  private scrollLog(): void {
    const list = this.drawer?.querySelector('.console-list');
    if (list) list.scrollTop = list.scrollHeight;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
