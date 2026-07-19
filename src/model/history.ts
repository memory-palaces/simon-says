/**
 * A generic snapshot undo/redo stack. We serialise each state to JSON, which is
 * cheap here because a palace is small plain data — no three.js objects, no
 * cycles. Serialising also guarantees each restored state is fully detached from
 * the live object, so undo can't hand back a shared reference that later mutates.
 */
export class History<T> {
  private stack: string[] = [];
  private index = -1;

  constructor(private readonly limit = 100) {}

  /** Start fresh with `state` as the only (baseline) entry. */
  reset(state: T): void {
    this.stack = [JSON.stringify(state)];
    this.index = 0;
  }

  /**
   * Record a new state. Anything after the current point (a previously undone
   * branch) is discarded — the usual linear-history behaviour. Identical
   * consecutive states are ignored so no-op changes don't create dead steps.
   */
  push(state: T): void {
    const snap = JSON.stringify(state);
    if (this.index >= 0 && this.stack[this.index] === snap) return;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(snap);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  undo(): T | null {
    if (!this.canUndo()) return null;
    this.index -= 1;
    return JSON.parse(this.stack[this.index]) as T;
  }

  redo(): T | null {
    if (!this.canRedo()) return null;
    this.index += 1;
    return JSON.parse(this.stack[this.index]) as T;
  }
}
