import { assertPalace, type Palace } from './palace';

/**
 * A local-only safety net: the working palace is mirrored to localStorage on every
 * change (debounced by the caller) so a refresh, crash, or bug can't lose the
 * user's loci and mnemonics. This is NOT the file format — explicit Save still
 * exports a real .json. The draft just means "never start from nothing by accident".
 */
const KEY = 'mempal:draft:v1';

export function saveDraft(palace: Palace): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(palace));
  } catch {
    // localStorage can throw (private mode, quota). A failed autosave must never
    // break the app — the user still has explicit Save.
  }
}

export function loadDraft(): Palace | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    assertPalace(data);
    return data;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
