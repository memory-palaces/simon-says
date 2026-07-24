/**
 * Client for the local dev-server save/open API (see the palaceServer plugin in
 * vite.config.ts). This talks only to the server you're already running on
 * localhost — palaces are written to a `saved/` folder on your own machine, not
 * uploaded anywhere. When the app is served as a plain static build (no dev
 * server), `serverAvailable()` returns false and the UI falls back to files.
 */
import { assertPalace, type Palace } from './palace';

export interface ServerItem {
  name: string;
  size: number;
  mtime: number;
}

/** Is the local save/open API reachable, and where does it save? */
export async function serverInfo(): Promise<{ online: boolean; dir: string | null }> {
  try {
    const r = await fetch('/api/ping');
    if (!r.ok) return { online: false, dir: null };
    const j = (await r.json()) as { palaceServer?: boolean; dir?: string };
    return { online: j?.palaceServer === true, dir: j?.dir ?? null };
  } catch {
    return { online: false, dir: null };
  }
}

export async function listServerPalaces(): Promise<ServerItem[]> {
  const r = await fetch('/api/palaces');
  if (!r.ok) throw new Error('Could not list saved worlds.');
  return ((await r.json()) as { items: ServerItem[] }).items;
}

export async function saveServerPalace(name: string, palace: Palace): Promise<void> {
  const r = await fetch(`/api/palaces/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(palace),
  });
  if (!r.ok) throw new Error('Save to the local server failed.');
}

export async function loadServerPalace(name: string): Promise<Palace> {
  const r = await fetch(`/api/palaces/${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error('Load from the local server failed.');
  const data = await r.json();
  assertPalace(data);
  return data;
}

export async function deleteServerPalace(name: string): Promise<void> {
  await fetch(`/api/palaces/${encodeURIComponent(name)}`, { method: 'DELETE' });
}
