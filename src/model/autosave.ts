import { assertPalace, type Palace } from './palace';

/**
 * A local-only safety net: the working palace is mirrored on every change so a
 * refresh, crash, or bug can't lose the user's loci and mnemonics. This is NOT the
 * file format — explicit Save exports a real .json.
 *
 * Storage is IndexedDB, not localStorage: a palace embeds its GLB and any generated
 * images/meshes as data URLs, which easily exceeds localStorage's ~5 MB cap. IDB has
 * no practical limit, so the draft "just works" for realistic sizes.
 */
const DB_NAME = 'mempal';
const STORE = 'draft';
const KEY = 'current';
const LEGACY_LS_KEY = 'mempal:draft:v1'; // pre-IndexedDB location, migrated on first read

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(store: IDBObjectStore, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDraft(palace: Palace): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    // Structured-clone stores the object directly — no JSON size juggling.
    await idbRequest(tx.objectStore(STORE), (s) => s.put(palace, KEY));
  } catch {
    // A failed autosave must never break the app — explicit Save still works.
  }
}

export async function loadDraft(): Promise<Palace | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const data = await idbRequest<unknown>(tx.objectStore(STORE), (s) => s.get(KEY));
    if (data) {
      assertPalace(data);
      return data;
    }
  } catch {
    /* fall through to legacy migration */
  }
  return migrateLegacyDraft();
}

export async function clearDraft(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    await idbRequest(tx.objectStore(STORE), (s) => s.delete(KEY));
  } catch {
    /* ignore */
  }
}

/** One-time: pull a draft written by the old localStorage version into IndexedDB. */
async function migrateLegacyDraft(): Promise<Palace | null> {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    assertPalace(data);
    await saveDraft(data);
    localStorage.removeItem(LEGACY_LS_KEY);
    return data;
  } catch {
    return null;
  }
}
