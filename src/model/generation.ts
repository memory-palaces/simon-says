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

// --- Local ComfyUI backend (the flagship local-GPU path) --------------------

export const DEFAULT_LOCAL_URL = 'http://127.0.0.1:8188';

/**
 * A minimal ComfyUI API-format text-to-image workflow. The user edits this to
 * match a checkpoint they actually have. Two placeholders are substituted at
 * render time: {PROMPT} (their words, JSON-escaped) and {SEED} (an integer).
 */
export const DEFAULT_LOCAL_WORKFLOW = JSON.stringify(
  {
    '3': { class_type: 'KSampler', inputs: { seed: '{SEED}', steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '{PROMPT}', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, text, watermark', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'mempal', images: ['8', 0] } },
  },
  null,
  2,
).replace('"{SEED}"', '{SEED}'); // seed is a number field, not a string

export interface LocalConfig {
  url: string;
  imageWorkflow: string;
}

/** Ping a ComfyUI server; throws with a helpful message if unreachable. */
export async function testLocalConnection(url: string): Promise<void> {
  const base = url.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/system_stats`);
  } catch {
    throw new Error('Could not reach ComfyUI. Is it running, and started with CORS enabled (--enable-cors-header "*")?');
  }
  if (!res.ok) throw new Error(`ComfyUI responded ${res.status}.`);
}

export class LocalComfyBackend implements GenerationBackend {
  readonly id = 'local';
  readonly label = 'Local ComfyUI (localhost)';
  readonly offline = false;

  async generateImage(prompt: string, seed: number): Promise<string> {
    const cfg = loadGenerationSettings().local;
    if (!cfg?.url) throw new Error('Set your ComfyUI URL in the Generation panel.');
    if (!cfg.imageWorkflow?.trim()) throw new Error('Paste a ComfyUI API-format workflow (keep {PROMPT}).');
    const base = cfg.url.replace(/\/+$/, '');

    // Vary the seed by prompt + reroll so rerolls differ but stay reproducible.
    const seedVal = (parseInt(promptHash(prompt), 16) + seed * 100003) % 2147483647;
    const text = cfg.imageWorkflow.replaceAll('{PROMPT}', escapeJsonString(prompt)).replaceAll('{SEED}', String(seedVal));

    let workflow: unknown;
    try {
      workflow = JSON.parse(text);
    } catch {
      throw new Error('Workflow is not valid JSON after inserting the prompt.');
    }

    const submit = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: `mempal-${promptHash(prompt)}${seed}` }),
    });
    if (!submit.ok) {
      throw new Error(`ComfyUI rejected the workflow (${submit.status}). Check the checkpoint name and node graph.`);
    }
    const { prompt_id: promptId } = (await submit.json()) as { prompt_id: string };
    return this.waitForImage(base, promptId);
  }

  private async waitForImage(base: string, promptId: string): Promise<string> {
    // Poll history until the run produces an image (or we give up after ~3 min).
    for (let i = 0; i < 180; i++) {
      await sleep(1000);
      const res = await fetch(`${base}/history/${promptId}`);
      if (!res.ok) continue;
      const history = (await res.json()) as Record<string, { outputs?: Record<string, { images?: ComfyImage[] }> }>;
      const outputs = history[promptId]?.outputs;
      if (!outputs) continue;
      for (const nodeId of Object.keys(outputs)) {
        const images = outputs[nodeId].images;
        if (images && images.length > 0) return this.fetchImage(base, images[0]);
      }
    }
    throw new Error('Timed out waiting for ComfyUI to finish rendering.');
  }

  private async fetchImage(base: string, image: ComfyImage): Promise<string> {
    const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? '', type: image.type ?? 'output' });
    const res = await fetch(`${base}/view?${query.toString()}`);
    if (!res.ok) throw new Error('Rendered, but could not download the image from ComfyUI.');
    return blobToDataUrl(await res.blob());
  }
}

interface ComfyImage {
  filename: string;
  subfolder?: string;
  type?: string;
}

// --- fal.ai cloud backend (byo-key, browser-friendly, fastest to try) -------

export const DEFAULT_FAL_MODEL = 'fal-ai/flux/schnell';

export interface FalConfig {
  apiKey: string;
  model?: string;
}

/**
 * Hosted image generation via fal.ai. Chosen because it allows direct browser
 * calls (CORS) — most image APIs (OpenAI, Replicate) are server-only. The key
 * lives in localStorage and is sent ONLY to fal.ai, per the spec.
 */
export class FalBackend implements GenerationBackend {
  readonly id = 'fal';
  readonly label = 'fal.ai (cloud, API key)';
  readonly offline = false;

  async generateImage(prompt: string, seed: number): Promise<string> {
    const cfg = loadGenerationSettings().fal;
    if (!cfg?.apiKey) throw new Error('Enter your fal.ai API key in the Generation panel.');
    const model = cfg.model?.trim() || DEFAULT_FAL_MODEL;
    const seedVal = (parseInt(promptHash(prompt), 16) + seed * 100003) % 2147483647;

    const res = await fetch(`https://fal.run/${model}`, {
      method: 'POST',
      headers: { Authorization: `Key ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, num_images: 1, image_size: 'square_hd', seed: seedVal }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { detail?: unknown };
        if (body?.detail) detail = `: ${typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)}`;
      } catch {
        /* ignore */
      }
      throw new Error(`fal.ai error ${res.status}${detail}`);
    }
    const data = (await res.json()) as { images?: Array<{ url?: string }> };
    const url = data.images?.[0]?.url;
    if (!url) throw new Error('fal.ai returned no image.');

    // Copy into a data URL so the palace keeps the image (fal URLs are temporary).
    const img = await fetch(url);
    if (!img.ok) throw new Error('Could not download the generated image from fal.ai.');
    return blobToDataUrl(await img.blob());
  }
}

/** Backends available in this build. `none` is represented by absence (null). */
const BACKENDS: GenerationBackend[] = [new PlaceholderBackend(), new FalBackend(), new LocalComfyBackend()];

export function listBackends(): GenerationBackend[] {
  return BACKENDS;
}

export function getBackend(id: string): GenerationBackend | null {
  if (id === NONE_ID) return null;
  return BACKENDS.find((b) => b.id === id) ?? null;
}

// --- Which backend is active (persisted, app-level not per-palace) ----------

const SETTINGS_KEY = 'mempal:generation:v1';

/** App-global generation credentials. The pipeline CHOICE is per-world (in Palace). */
export interface GenerationSettings {
  local?: LocalConfig;
  fal?: FalConfig;
}

export function loadGenerationSettings(): GenerationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as GenerationSettings;
  } catch {
    /* ignore */
  }
  return {};
}

export function saveGenerationSettings(settings: GenerationSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

/** Escape a string for safe insertion into a JSON string literal (drops the quotes). */
function escapeJsonString(s: string): string {
  const json = JSON.stringify(s);
  return json.slice(1, -1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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
