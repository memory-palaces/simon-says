/**
 * The pluggable generation backend. SPEC.md is emphatic about one thing: the AI
 * only RENDERS the user's written description — it never invents, suggests, or
 * "improves" it. So every backend takes the locus's `image_prompt` VERBATIM and
 * returns pixels. There is no code path here that generates or edits prompt text.
 *
 * Three implementations are envisioned (none / byo-key / local TRELLIS). This file
 * ships the interface, the `none` default, and an offline `placeholder` backend
 * that draws the prompt onto a canvas — no keys, no network — so the whole
 * generate → approve → reroll pipeline is real and testable before any cloud or
 * localhost backend exists. Real backends implement the same interface.
 */

export interface GenerationBackend {
  readonly id: string;
  readonly label: string;
  /** True if it needs no network or API key (works fully offline). */
  readonly offline: boolean;
  /**
   * Render `prompt` (the user's exact words) to a 2D image, returned as a PNG data
   * URL. `seed` lets "reroll" produce a different image for the same prompt.
   */
  generateImage(prompt: string, seed: number): Promise<string>;
}

export const NONE_ID = 'none';

/** A tiny stable string hash (FNV-1a) for cache keys keyed on the prompt. */
export function promptHash(prompt: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Offline placeholder: renders the prompt as a captioned "card". Deterministic
 * palette per prompt+seed so rerolls visibly differ but the same prompt+seed is
 * reproducible. This is NOT AI — it's a stand-in that keeps the app 100% usable
 * with zero setup, and proves the pipeline the real backends will plug into.
 */
export class PlaceholderBackend implements GenerationBackend {
  readonly id = 'placeholder';
  readonly label = 'Placeholder (offline)';
  readonly offline = true;

  async generateImage(prompt: string, seed: number): Promise<string> {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Seed a hue from prompt + seed so each reroll shifts colour.
    const base = (parseInt(promptHash(prompt), 16) + seed * 47) % 360;
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, `hsl(${base}, 55%, 32%)`);
    g.addColorStop(1, `hsl(${(base + 60) % 360}, 55%, 18%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    // A few seeded blobs for texture.
    let s = (parseInt(promptHash(prompt), 16) ^ (seed * 2654435761)) >>> 0;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0xffffffff);
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = `hsl(${(base + rand() * 120) % 360}, 70%, ${40 + rand() * 30}%)`;
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, 30 + rand() * 90, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Caption the prompt so the placeholder still carries the user's meaning.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, size - 170, size, 170);
    ctx.fillStyle = '#fff';
    ctx.font = '600 26px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    wrapText(ctx, prompt || '(no description)', size / 2, size - 130, size - 48, 32);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '14px ui-monospace, monospace';
    ctx.fillText('placeholder render — no AI', size / 2, size - 20);

    return canvas.toDataURL('image/png');
  }
}

/** Backends available in this build. `none` is represented by absence (null). */
const BACKENDS: GenerationBackend[] = [new PlaceholderBackend()];

export function listBackends(): GenerationBackend[] {
  return BACKENDS;
}

export function getBackend(id: string): GenerationBackend | null {
  if (id === NONE_ID) return null;
  return BACKENDS.find((b) => b.id === id) ?? null;
}

// --- Which backend is active (persisted, app-level not per-palace) ----------

const SETTINGS_KEY = 'mempal:generation:v1';

export interface GenerationSettings {
  backendId: string;
}

export function loadGenerationSettings(): GenerationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as GenerationSettings;
  } catch {
    /* ignore */
  }
  return { backendId: NONE_ID };
}

export function saveGenerationSettings(settings: GenerationSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

/** Word-wrap helper for the placeholder caption. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 3);
  if (lines.length > 3) shown[2] += '…';
  const startY = y - ((shown.length - 1) * lineHeight) / 2;
  shown.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}
