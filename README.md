# Simon Says

> Named for Simonides of Ceos, who — legend says — invented the method of loci after
> a banquet-hall roof collapsed and he could name every guest by remembering where
> they had sat. Live demo: **https://memory-palaces.github.io/simon-says/**

A local-first web app for building and reviewing **memory palaces** (the method of
loci). Import a 3D model of a space you know, walk it in first person, drop numbered
**loci** on physical features, and attach a **bizarre mnemonic image** to each one.
Review mode walks the route and quizzes you.

Runs entirely offline. No accounts, no cloud dependency, no telemetry.

> **Core principle:** *you* write the mnemonic image; the app only ever renders it.
> The cognitive work of inventing a weird association is what makes a memory stick,
> so the tool never auto-generates, suggests, or "improves" your wording.

---

## Quick start

**Just try it:** open **https://memory-palaces.github.io/simon-says/** — nothing to
install. A first-run guide pops up (📖 Guide brings it back any time). To run it
locally instead, you need one of:

**Node (recommended):**
```bash
npm install
npm run dev            # then open the printed http://localhost:5173
```

**Docker (zero local tooling):**
```bash
docker compose up      # then open http://localhost:5173
```

A small sample space (**Virtual City**) is bundled, so it renders immediately. To
also pull the iconic **Sponza** atrium (≈50 MB, fetched from the official Khronos
sample repo):
```bash
npm run fetch-samples
```

To build static files you can serve anywhere:
```bash
npm run build          # outputs dist/
```

**Desktop app (Electron):** for a native window — and, importantly, **real
save-to-file on any OS** (the File System Access API only works in Chromium; Electron
bundles it, so Firefox/Safari users get proper Ctrl+S here):
```bash
npm run electron       # builds, then opens the app in a native window
npm run electron:dev   # dev: run `npm run dev` first, then this points at :5173
```

---

## Using it

The app has three modes: **walk** (first person), **edit** (the side panel), and
**review**.

**Build a palace**
1. Click **▶ Walk** (or click the 3D view) to enter first person.
2. Look at a wall or object and press **`E`** to drop a locus (a glowing numbered
   marker).
3. Look at a marker and press **`X`** to delete or **`G`** to grab/move it. **Click**
   a marker to jump straight to its editor.
4. Press **`Esc`** to return to the panel. Click a locus to write its **location cue**
   and **your mnemonic image**. Reorder with ▲▼.
5. **Save** exports a self-contained `.json` (your model is embedded, so **Load** is
   one step). Your work also autosaves to the browser as you go, and there's full
   **undo/redo** (`Ctrl/Cmd+Z`).

**Review**: click **Review ▸** to walk the route in order — each stop shows the
location, you recall the image, then press **Space** to reveal your own words.

**Bring your own space**: drag any `.glb` / `.gltf` onto the window. If you already
have loci it asks whether to start a new palace or keep them (for an updated model of
the same space). Drag a saved `.json` to load a palace.

### Controls

| | |
|---|---|
| Move | `W A S D` / arrow keys |
| Look | mouse |
| Run | `Shift` |
| Jump | `Space` |
| Fly / no-clip (through walls) | `F` — then `Space` / `C` for up / down |
| Recenter on the floor | `R` (or the ⌖ button) |
| Drop / delete / move a locus | `E` / `X` / `G` |
| Undo / redo | `Ctrl/Cmd+Z` / `+Shift+Z` |

---

## Image generation (optional)

A locus works perfectly with just typed text. If you want a rendered image (and,
later, a 3D object) at each locus, pick a pipeline in the panel's **Image pipeline**
dropdown. Keys/endpoints are configured once in **Settings** (the ⚙ button).

You always write the mnemonic; generation only renders your words. A **Style** menu
(realistic / cartoon / … / **3D-ready**) appends a rendering hint without changing
your text — "3D-ready" asks for a single isolated object on a plain background, which
is much easier to turn into a clean 3D mesh.

### Options

- **Placeholder (offline)** — no setup, no keys. Renders your prompt onto a card.
  Good for trying the whole flow, including a stand-in "3D" mesh.

- **fal.ai (cloud, API key)** — the fastest path to real images. fal.ai works
  directly from the browser (most image APIs don't), hosts fast/cheap models (Flux
  schnell) and TRELLIS for image→3D.
  1. Sign up at [fal.ai](https://fal.ai) and create a key at
     `fal.ai/dashboard/keys`.
  2. Open **Settings (⚙)** → paste the key. Pick a **Model** in the panel.
  3. Set the world's pipeline to **fal.ai**.

  Your key is stored only in this browser and sent only to fal.ai. You pay fal per
  render.

- **Local ComfyUI (localhost)** — free, private, on your own GPU. The flagship path.
  1. Install and run [ComfyUI](https://github.com/comfyanonymous/ComfyUI). Start it
     with CORS enabled so the browser app can reach it:
     ```bash
     python main.py --enable-cors-header "*"
     ```
     This is also what makes the hosted app at `memory-palaces.github.io` able to
     talk to your local ComfyUI: browsers allow an https page to reach `localhost`,
     but only if ComfyUI answers with that CORS header.
  2. In ComfyUI, build a text-to-image graph and export it with **Save (API Format)**.
  3. Open **Settings (⚙)** → set the ComfyUI URL (default `http://127.0.0.1:8188`) and
     paste the API-format workflow. Keep the `{PROMPT}` and `{SEED}` placeholders, and
     set `ckpt_name` to a checkpoint you actually have. Use **Test connection**.

  For **image→3D**, [TRELLIS 2](https://github.com/microsoft/TRELLIS) is the
  recommended model (MIT-licensed, unlike some alternatives that carry regional usage
  restrictions). Local image→3D wiring is not finished yet — for now, use fal.ai for
  the 3D step, or the offline placeholder to exercise the flow.

### Two-stage pipeline

1. Type a description → **Render image** → approve or **Reroll** (every render is kept
   in a session history you can page through).
2. Only after approving → **Make 3D** → the mesh appears at the locus.

---

## How a palace is stored

- **Authoring format** — the `.json` you Save. It embeds the model and stores loci in
  *asset-local* coordinates, so you can swap in an improved model and every locus
  stays put. This is the working format.
- Generated images/meshes are embedded as data URLs (self-contained, at the cost of a
  larger file). Very large models may exceed the browser's autosave quota; explicit
  **Save** always works.

A future *delivery* format (a single baked `.glb` any glTF viewer can open) is
described in `SPEC-addendum-export.md`.

---

## Tech

three.js + Vite + TypeScript. `GLTFLoader` for import, `PointerLockControls` for
mouse-look, simple raycast collision (raycast down for the floor, forward for walls —
no physics engine). Plain-DOM UI, no framework.

Source layout:
- `src/model/` — palace types, persistence, autosave, undo history, generation
  backends (pure-ish data).
- `src/engine/` — the three.js viewer, first-person controls, loci markers, GLB
  loading.
- `src/ui/` — editor panel, settings, review, dialogs.

## Status

Implemented: first-person walkthrough; drop/move/delete/reorder loci; save/load;
review; text mnemonics; autosave + undo/redo; image generation (offline placeholder,
fal.ai cloud, local ComfyUI) with styles, history, and an image→3D stage.

Not yet: local (ComfyUI/TRELLIS) image→3D; nested child palaces; the baked-GLB export
in Addendum A.

See `SPEC.md` for the full design and build order.

## License

MIT. Sample models are CC-BY / MIT from the Khronos glTF-Sample-Assets repository.
