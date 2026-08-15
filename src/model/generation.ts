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

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export interface GenerationBackend {
  readonly id: string;
  readonly label: string;
  /** True if it needs no network or API key (works fully offline). */
  readonly offline: boolean;
  /** True if this backend can turn an approved 2D image into a 3D mesh. */
  readonly can3d: boolean;
  /**
   * Render `prompt` (the user's exact words) to a 2D image, returned as a PNG data
   * URL. `seed` lets "reroll" produce a different image for the same prompt.
   */
  generateImage(prompt: string, seed: number): Promise<string>;
  /**
   * The expensive second stage, gated on 2D approval: turn the approved image into
   * a GLB, returned as a data URL. Present only when `can3d` is true.
   */
  imageTo3d?(imageDataUrl: string): Promise<string>;
}

export const NONE_ID = 'none';

/**
 * User-selectable style modifiers. Each suffix is APPENDED to the user's prompt to
 * steer the render — it never replaces or rewrites the mnemonic. The "3D-ready"
 * style asks for a single isolated object on a plain background, which is far
 * easier to turn into a clean 3D mesh than a full scene.
 */
export const STYLE_PRESETS: Array<{ id: string; label: string; suffix: string }> = [
  { id: 'none', label: 'No style', suffix: '' },
  { id: 'realistic', label: 'Realistic', suffix: ', photorealistic, highly detailed' },
  { id: 'cartoon', label: 'Cartoon', suffix: ', cartoon illustration, bold outlines, flat vivid colors' },
  { id: 'painterly', label: 'Painterly', suffix: ', digital painting, expressive brush strokes' },
  {
    id: 'prop3d',
    label: '3D-ready (isolated object)',
    suffix:
      ', a single isolated object, centered, full object in frame, plain neutral studio background, soft even lighting, no scene, product shot',
  },
];

/** Common fal.ai image models for the quick-switch dropdown. */
export const FAL_MODEL_PRESETS: Array<{ id: string; label: string }> = [
  { id: 'fal-ai/flux/schnell', label: 'Flux schnell (fast)' },
  { id: 'fal-ai/flux/dev', label: 'Flux dev (quality)' },
  { id: 'fal-ai/fast-sdxl', label: 'Fast SDXL' },
  { id: 'fal-ai/flux-pro/v1.1', label: 'Flux Pro 1.1' },
];

/**
 * The editable rendering preamble. It goes IN FRONT of the user's mnemonic on every
 * render — a standing instruction to the image model about *how* to draw, never
 * about *what* to draw. The mnemonic itself is still passed through verbatim; this
 * is the knob for people who want their whole palace in one visual language.
 * Editable (and resettable) in Settings, stored in this browser.
 */
export const DEFAULT_PREAMBLE =
  'A vivid, memorable mnemonic illustration for a memory palace. Make the subject unmistakable and a little absurd, ' +
  'with strong silhouettes and high contrast so it is easy to recall. Depict exactly what is described, nothing more:';

/** The preamble in force (falls back to the default when unset). */
export function activePreamble(): string {
  const stored = loadGenerationSettings().preamble;
  return stored === undefined ? DEFAULT_PREAMBLE : stored;
}

/**
 * Assemble what actually gets sent: [preamble] + the user's words + [style suffix].
 * The user's words are never edited — only framed.
 */
export function buildPrompt(prompt: string, styleId?: string, preamble = activePreamble()): string {
  const preset = STYLE_PRESETS.find((p) => p.id === styleId);
  const head = preamble.trim() ? `${preamble.trim()} ` : '';
  return `${head}${prompt}${preset?.suffix ?? ''}`;
}

/** @deprecated use buildPrompt — kept so older call sites keep compiling. */
export function applyStyle(prompt: string, styleId?: string): string {
  return buildPrompt(prompt, styleId);
}

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
  readonly can3d = true;

  /** "3D" placeholder: a textured double-sided plane exported as a GLB. */
  async imageTo3d(imageDataUrl: string): Promise<string> {
    const tex = await new THREE.TextureLoader().loadAsync(imageDataUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
    );
    const glb = (await new GLTFExporter().parseAsync(mesh, { binary: true })) as ArrayBuffer;
    return `data:model/gltf-binary;base64,${base64FromArrayBuffer(glb)}`;
  }

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
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'simon-says', images: ['8', 0] } },
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
  readonly can3d = false; // local TRELLIS workflow support is a later step

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
      body: JSON.stringify({ prompt: workflow, client_id: `simon-says-${promptHash(prompt)}${seed}` }),
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
  readonly can3d = true;

  /** Image → GLB via fal-ai/trellis. Unverified here (needs a key). */
  async imageTo3d(imageDataUrl: string): Promise<string> {
    const cfg = loadGenerationSettings().fal;
    if (!cfg?.apiKey) throw new Error('Enter your fal.ai API key in Settings.');
    const res = await fetch('https://fal.run/fal-ai/trellis', {
      method: 'POST',
      headers: { Authorization: `Key ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageDataUrl }),
    });
    if (!res.ok) throw new Error(`fal.ai 3D error ${res.status}. (Large images may need a hosted URL.)`);
    const data = (await res.json()) as { model_mesh?: { url?: string } };
    const url = data.model_mesh?.url;
    if (!url) throw new Error('fal.ai returned no mesh.');
    const glb = await fetch(url);
    if (!glb.ok) throw new Error('Could not download the generated mesh from fal.ai.');
    return blobToDataUrl(await glb.blob());
  }

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
  // The offline placeholder is hidden from the picker — it's only the silent
  // fallback when a world has no real pipeline chosen (so Render always works).
  return BACKENDS.filter((b) => b.id !== 'placeholder');
}

export function getBackend(id: string): GenerationBackend | null {
  if (id === NONE_ID) return null;
  return BACKENDS.find((b) => b.id === id) ?? null;
}

// --- Which backend is active (persisted, app-level not per-palace) ----------

const SETTINGS_KEY = 'simon-says:generation:v1';
const LEGACY_SETTINGS_KEY = 'mempal:generation:v1'; // pre-rename key, migrated on first read

/** App-global generation credentials. The pipeline CHOICE is per-world (in Palace). */
export interface GenerationSettings {
  local?: LocalConfig;
  fal?: FalConfig;
  /** Rendering preamble prepended to every prompt; undefined = DEFAULT_PREAMBLE. */
  preamble?: string;
  /** Milliseconds for the go-to / recenter camera glide (0 = instant). */
  transitionMs?: number;
}

export function loadGenerationSettings(): GenerationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as GenerationSettings;
    const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (legacy) {
      localStorage.setItem(SETTINGS_KEY, legacy);
      localStorage.removeItem(LEGACY_SETTINGS_KEY);
      return JSON.parse(legacy) as GenerationSettings;
    }
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

/** Base64-encode an ArrayBuffer in chunks (avoids call-stack limits on big GLBs). */
function base64FromArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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
