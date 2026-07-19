import { assertPalace, type Palace } from './palace';

/**
 * Saving and loading the palace JSON. Where the File System Access API exists we
 * keep the file HANDLE, so saving writes back to the SAME file (Ctrl+S) instead of
 * downloading a fresh copy every time — real save/load, not import/export. Older
 * browsers fall back to a download/upload.
 */

// The permission methods aren't in every TS lib.dom yet; narrow via a cast.
interface FsPermission {
  queryPermission?(opts: { mode: string }): Promise<PermissionState>;
  requestPermission?(opts: { mode: string }): Promise<PermissionState>;
}
interface PickerWindow extends Window {
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
}

const JSON_TYPES = [{ description: 'Memory palace', accept: { 'application/json': ['.json'] } }];

function fileName(palace: Palace): string {
  const base = palace.name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'palace';
  return `${base}.json`;
}

async function ensureWritable(handle: FileSystemFileHandle): Promise<boolean> {
  const perm = handle as unknown as FsPermission;
  const opts = { mode: 'readwrite' };
  if (!perm.queryPermission) return true; // permission model not present; assume ok
  if ((await perm.queryPermission(opts)) === 'granted') return true;
  return (await perm.requestPermission?.(opts)) === 'granted';
}

async function writeHandle(handle: FileSystemFileHandle, json: string): Promise<boolean> {
  if (!(await ensureWritable(handle))) return false;
  const writable = await handle.createWritable();
  await writable.write(json);
  await writable.close();
  return true;
}

export type SaveOutcome =
  | { status: 'handle'; handle: FileSystemFileHandle }
  | { status: 'download' }
  | { status: 'cancelled' };

/**
 * Save the palace. With a `handle`, writes back to that file silently (real save).
 * Otherwise prompts (Save As); falls back to a download when the API is missing.
 */
export async function savePalace(palace: Palace, handle: FileSystemFileHandle | null): Promise<SaveOutcome> {
  const json = JSON.stringify(palace, null, 2);
  const w = window as PickerWindow;

  if (handle) {
    try {
      if (await writeHandle(handle, json)) return { status: 'handle', handle };
    } catch {
      // Handle gone stale (file moved/deleted) — fall through to a fresh Save As.
    }
  }

  if (w.showSaveFilePicker) {
    try {
      const picked = await w.showSaveFilePicker({ suggestedName: fileName(palace), types: JSON_TYPES });
      await writeHandle(picked, json);
      return { status: 'handle', handle: picked };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return { status: 'cancelled' };
    }
  }

  // Fallback: download.
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(palace);
  a.click();
  URL.revokeObjectURL(url);
  return { status: 'download' };
}

/** Parse + validate a palace from a File (drag-drop). No writable handle. */
export async function readPalaceFile(file: File): Promise<Palace> {
  const data = JSON.parse(await file.text());
  assertPalace(data);
  return data;
}

export interface OpenedPalace {
  palace: Palace;
  handle: FileSystemFileHandle | null;
}

/** Open via the system picker (retaining a writable handle) or a hidden input. */
export async function openPalace(): Promise<OpenedPalace | null> {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: JSON_TYPES });
      const palace = await readPalaceFile(await handle.getFile());
      return { palace, handle };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    }
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      readPalaceFile(file).then((palace) => resolve({ palace, handle: null })).catch(reject);
    };
    input.click();
  });
}
