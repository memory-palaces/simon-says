import { assertPalace, type Palace } from './palace';

/**
 * Saving and loading the palace JSON. We prefer the File System Access API so the
 * user picks a real location (and, later, a folder they can zip), but fall back to
 * a plain download/upload so the app works from any static server or older browser.
 *
 * For the text-only tool (steps 2–5) a palace is a single .json file that
 * references its GLB by name. Generated image/mesh assets come later and will turn
 * this into a folder.
 */

interface PickerWindow extends Window {
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
}

function fileName(palace: Palace): string {
  const base = palace.name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'palace';
  return `${base}.json`;
}

export async function savePalace(palace: Palace): Promise<void> {
  const json = JSON.stringify(palace, null, 2);
  const w = window as PickerWindow;

  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName(palace),
        types: [{ description: 'Memory palace', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await (handle as FileSystemFileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (err) {
      // AbortError = user cancelled the dialog; anything else falls through to download.
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }

  // Fallback: trigger a download.
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(palace);
  a.click();
  URL.revokeObjectURL(url);
}

/** Parse + validate a palace from a File (drag-drop or picker). */
export async function readPalaceFile(file: File): Promise<Palace> {
  const text = await file.text();
  const data = JSON.parse(text);
  assertPalace(data);
  return data;
}

/** Open the system file picker (or a hidden input) and return the chosen palace. */
export async function openPalace(): Promise<Palace | null> {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: [{ description: 'Memory palace', accept: { 'application/json': ['.json'] } }],
      });
      return await readPalaceFile(await handle.getFile());
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    }
  }

  // Fallback: a transient <input type="file">.
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      readPalaceFile(file).then(resolve).catch(reject);
    };
    input.click();
  });
}
