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

Four sample worlds are bundled, so it renders immediately and **New** lets you
switch between them:

| World | What it is |
|---|---|
| **Simon's Street** (default) | A bright neighbourhood: houses, café, school, park, roundabout |
| **Plato's Cave** | Cavern chambers, from the prisoners' cell past the fire out to daylight |
| **Forest Camp** | A sunlit clearing: camp, archery range, lookout hut, bridge |
| **The Dungeon** | An undercroft: entrance hall, barred cell, treasury, great room, stair down |

The first four are built from Kenney CC0 kits by `scripts/worlds/` — see
[Design your own town](#design-your-own-town-from-the-kenney-kits). The sci-fi
**Virtual City** is bundled too (pick it under New). To also pull the iconic **Sponza** atrium (≈50 MB, fetched from the official Khronos
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
1. Click **▶ Enter** (or click the 3D view) to enter first person.
2. Look at a wall or object and press **`T`** to drop a locus (a glowing numbered
   marker).
3. Look at a marker and press **`B`** to delete or **`G`** to grab/move it. **Click**
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
the same space). Drag a saved `.json` to load a palace. See
[Making your own world](#making-your-own-world) for where models come from.

### Controls

| | |
|---|---|
| Move | `W A S D` / arrow keys |
| Look | mouse |
| Run | `Shift` |
| Jump | `Space` |
| Fly / no-clip (through walls) | `F` — then `Space` / `C` for up / down. Press `F` while up in the air and you fall. |
| Recenter on the floor | `R` (or the ⌖ button) |
| Bird's-eye view of the whole world | `V` — click a spot up there to go straight to it |
| Drop / delete / move a locus | `T` / `B` / `G` |
| Drop a portal / go through it | `P` / `Enter` (aim at it) · `Q` returns |
| World map / full cheat-sheet | `M` / `?` |
| Undo / redo | `Ctrl/Cmd+Z` / `+Shift+Z` |

---

## Making your own world

The best palace is a place you already know — your home, your street, your old
school. Simon Says walks any **`.glb` / `.gltf`** file, so the question is just how to
get one. It doesn't have to be pretty: a crude box-model of your flat works as well
as a photoreal scan, because *you* supply the memories, the model only anchors them.

Rough guide, cheapest-and-most-private first. "Private" means your photos/scans
never leave your device; "cloud" means they're uploaded and processed on someone
else's server (read their retention terms if the space is your home).

| Route | Cost | Private? | What you get |
|---|---|---|---|
| **Use a free ready-made scene** — [Kenney](https://kenney.nl/assets?q=3d) kits (CC0), [Quaternius](https://quaternius.com) (CC0), [Poly Pizza](https://poly.pizza), [Sketchfab](https://sketchfab.com/search?features=downloadable&licenses=322a749bcfa841b29dff1e8a1bb74b0b&type=models) (filter *downloadable* + CC), Khronos samples (`npm run fetch-samples` pulls Sponza) | free | n/a | Instant. Not *your* place, but a vivid one — fine for a first palace. |
| **Box-model it in Blender** — [Blender](https://www.blender.org) is free; block out rooms with cubes, colour the walls, *File → Export → glTF 2.0*. An hour gets you a recognisable floor plan of your home. | free | ✅ | Low-detail but exactly your layout, and it loads instantly. |
| **Assemble from a kit in Blender** — import Kenney/Quaternius pieces (they ship as glTF/OBJ) and arrange a street or house, then export one `.glb`. | free | ✅ | Bright, cartoonish, as many *distinct locations* as you want. |
| **Phone scan, processed on-device** — [Scaniverse](https://scaniverse.com) (iOS/Android, free, exports GLB); [3D Scanner App](https://3dscannerapp.com) (iOS, free, LiDAR iPhone/iPad, exports GLB/OBJ). | free | ✅ | A real scan of your real room in ~5 minutes. Rough edges, but unmistakably *your* place. |
| **Phone scan, processed in the cloud** — [Polycam](https://poly.cam) (free tier limited; Pro for GLTF export), [Luma AI](https://lumalabs.ai), [KIRI Engine](https://www.kiriengine.app), [RealityScan](https://www.realityscan.com) (Epic, free). | free → ~$15/mo | ❌ cloud | Usually cleaner results than on-device, and works on more phones. Export GLB/GLTF (or OBJ → Blender → GLB). |
| **Desktop photogrammetry from photos** — [Meshroom](https://alicevision.org/#meshroom) (free, open source, needs an NVIDIA GPU) or [RealityCapture](https://www.capturingreality.com) (Epic, free under $1M revenue, Windows). Take 50–200 overlapping photos with any camera. | free | ✅ | Highest-quality private option. Slow, and you'll usually clean up in Blender (decimate + export GLB). |
| **Professional capture** — [Matterport](https://matterport.com) and similar; download the mesh (Pro plans / MatterPak) and convert to GLB in Blender. | $$ | ❌ cloud | Whole houses, walk-through quality. Overkill for most, but great if it already exists (e.g. an estate-agent tour of a home you know). |
| **AI-generated spaces** — text/image → 3D *scenes* is moving fast (e.g. World Labs' Marble). Check whether the tool exports a mesh (`.glb`); many produce Gaussian splats, which Simon Says can't walk yet. | varies | ❌ cloud | An imaginary place that never existed — surprisingly memorable, and nothing personal is uploaded. |

### Design your own town from the Kenney kits

The starter world, **Simon's Street**, is assembled from three of
[Kenney](https://kenney.nl)'s CC0 kits — [City Kit (Suburban)](https://kenney.nl/assets/city-kit-suburban),
[City Kit (Roads)](https://kenney.nl/assets/city-kit-roads) and
[City Kit (Commercial)](https://kenney.nl/assets/city-kit-commercial). Each ships as
individual `.glb` pieces (houses, road tiles, trees, fences, shops), so you can lay
out your *own* street — your childhood road, a fantasy village — and it stays as
bright and readable as the sample. Ways to arrange the pieces, easiest first:

| Editor | Cost | How |
|---|---|---|
| **[Asset Forge](https://kenney.nl/tools/asset-forge)** (Kenney's own tool, Win/Mac/Linux) | ~$20 | Built for exactly this: drop kit blocks on a snapping grid, paint, then *Export → GLB*. Comes with its own blocks; add the kits above as custom ones. |
| **[Blender](https://www.blender.org)** | free | *File → Import → glTF 2.0* each piece you want (or *Edit → Preferences → File Paths → Asset Libraries* → add the kit's `GLB format` folder, then drag from the Asset Browser). Duplicate with `Shift+D`, hold `Ctrl` to snap, then *File → Export → glTF 2.0* the whole scene as one `.glb`. |
| **[Godot 4](https://godotengine.org)** | free | Drop the `.glb` files into a project, drag them into a 3D scene (grid snap in the toolbar), then *Scene → Export As… → glTF 2.0 Scene*. |
| **This repo's scripts** | free | `scripts/worlds/*.mjs` — each bundled world is a plain list of `w.place(kit, piece, x, z, {rot, v, s})` lines over a shared helper (`lib.mjs`). Copy `street.mjs` (or `cave.mjs` for interiors), edit the list, and run `npm run world -- <folder-with-the-unzipped-kits> street`. Colour variations (`v: 'a'|'b'|'c'` = blue / terracotta / grey roofs) come from a kit's `Textures/` folder. Two debugging aids: `node scripts/worlds/inspect.mjs "<kit>/Models/GLB format"` prints every piece's size, and `footprint.mjs <piece.glb>` draws an ASCII top-down map of its walls so you can see which side the doorway is on. |

Two gotchas the bundled worlds hit, worth knowing before you lay out a grid: a
Kenney `corridor` tile at rotation 0 runs **east-west** (its walls are on the north
and south edges), and the modular room pieces are open on all four sides. When a
corridor turns into a solid wall, it wants `rot: 90`.

Whatever you use: keep everything in **one `.glb`**, Y-up, and scale so a house is
about 7 m tall (the script multiplies Kenney's units by 6). Then just drag it onto
the app. Distinct landmarks — a red house next to a blue one, a park, a tower — are
what make loci easy to place and recall.

Tips that apply to all of them:

- **Keep it light.** Under ~30 MB loads fast anywhere; scans easily blow past that.
  In Blender: *Modifiers → Decimate* (ratio 0.1–0.3), and shrink textures to 2048px
  before export. The app embeds the model in your saved `.json`, so size matters twice.
- **Y is up, metres are metres.** glTF is Y-up; Blender's exporter handles that. If
  you come out giant or tiny, the per-world *player scale* setting in the sidebar fixes it.
- **Don't chase realism.** Distinct rooms, corners, furniture and colours are what
  loci attach to. A crude model with ten obvious landmarks beats a photoreal one
  that's all beige.
- **Made something nice from CC0 parts?** Open a PR — a bright, friendly default
  neighbourhood is on the wish-list.

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

## Credits

- **Simon's Street, Plato's Cave, Forest Camp, The Dungeon** — built from
  [Kenney](https://kenney.nl)'s CC0 kits (City Kit Suburban / Roads / Commercial,
  Modular Cave Kit, Mini Forest, Modular Dungeon Kit). Thanks Kenney!
- **Virtual City** and **Sponza** samples — [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets).

## License

MIT. Sample models are CC-BY / MIT from the Khronos glTF-Sample-Assets repository.
