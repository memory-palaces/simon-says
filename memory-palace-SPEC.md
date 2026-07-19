# Memory Palace — Project Spec

## What we're building

A local-first web app for building and reviewing **memory palaces** (method of loci).
The user imports a 3D model of a space they know in real life, walks through it in
first person, drops numbered **loci** on physical features, and attaches a
**bizarre mnemonic image** to each one. Review mode walks the route and quizzes them.

This is a personal tool released open source. Optimise for hackability and for
running entirely offline. No accounts, no cloud dependency, no telemetry.

## Core principle — do not violate this

**The user writes the mnemonic image description themselves. The AI only renders it.**

The cognitive work of inventing a bizarre association is the thing that makes the
memory stick. Never auto-generate image descriptions, never offer to "improve" the
user's wording, never suggest associations. The AI is a rendering service, not a
creative partner. Any UI that lets the machine do the imagining is a bug.

## Scope for v1

**In scope:**
- Import GLB/glTF geometry (a house, a floor, any space)
- First-person walkthrough with WASD + mouse look (Quake-style)
- Drop / move / delete / reorder loci by raycasting onto the imported mesh
- Attach to each locus: a user-written description, an optional generated 2D image,
  an optional generated 3D mesh
- Pluggable generation backend (see below)
- Review mode: walk the route in order, prompt before reveal
- Save/load the whole palace as a portable file

**Explicitly NOT in scope for v1:**
- A room/wall drawing tool. Geometry is authored elsewhere and imported.
- VR. Keep the renderer VR-*capable* by not doing anything exotic, but ship no VR UI.
- Accounts, sync, sharing, any server the user doesn't run.
- Spaced repetition scheduling (v2 — but leave a `last_reviewed` field in the model).

## Data model

Three independent layers. Keep them decoupled; this is the most important
structural decision in the project.

1. **Geometry** — one or more GLB assets. Carries no conceptual meaning.
2. **Route** — an *ordered list* of loci. This is the actual memory palace.
   A palace is linear, not a graph. Review always walks 1 → 2 → 3.
3. **Zones** — optional named regions for grouping and render culling.
   Purely cosmetic. The app must be fully usable with zero zones defined.

```jsonc
{
  "version": 1,
  "name": "Main floor",
  "assets": [
    { "id": "a1", "file": "assets/mainfloor.glb", "transform": [/* mat4 */] }
  ],
  "loci": [
    {
      "id": "l1",
      "order": 1,
      "label": "Kitchen island, north corner",
      "asset_id": "a1",              // anchor is asset-local, NOT world space
      "local_position": [1.2, 0.9, 3.4],
      "local_normal": [0, 1, 0],     // surface it snapped to
      "image_prompt": "a screaming lobster wearing my grandmother's reading glasses",
      "image_2d": "assets/gen/l1.png",
      "mesh_3d": "assets/gen/l1.glb",
      "child_palace": null,          // optional nested palace — see below
      "last_reviewed": null
    }
  ],
  "zones": []
}
```

**Anchoring rule:** loci store positions in *asset-local* coordinates, never world
coordinates. When the user re-exports an improved version of their house and swaps
the GLB, every locus must stay where they put it. This is what makes the tool
iterative instead of disposable.

**Nested palaces:** any locus may declare a `child_palace` pointing at another
palace file. Entering it is a scene transition, not a geometry problem — so a
full-size palace can live inside a refrigerator or a desk drawer. Support
descending into a child and returning to the parent at the same locus. Non-Euclidean
layouts are a feature, not something to warn the user about.

## Generation pipeline

Two stages, and the cheap stage gates the expensive one:

1. User types a description → generate a **2D image** → user approves or rerolls.
2. Only on approval → run **image-to-3D** → produce a GLB → place it at the locus.

Backends must be pluggable behind one interface with three implementations:

- **local** — talk to a user-run endpoint on localhost (ComfyUI or similar) running
  TRELLIS 2 for image-to-3D. Prefer TRELLIS: it's MIT-licensed, whereas Hunyuan3D
  carries regional usage restrictions. This is the default and the flagship path.
- **byo-key** — user supplies their own API key for a hosted service. Key lives in
  local storage only and is never logged or transmitted anywhere but the provider.
- **none** — no generation at all. A locus with just a typed description and a
  simple placeholder marker is a fully working memory palace. **The app must be
  100% functional in this mode**, and it should be the zero-config default so the
  thing runs the moment it's cloned.

Cache every generated asset on disk keyed by prompt hash. Never regenerate at
review time.

## Tech

- **three.js** + Vite. Plain TypeScript, no heavy framework.
- `GLTFLoader` for import, `PointerLockControls` for mouse look.
- Collision: keep it simple — raycast down for floor height, raycast forward for
  walls. No physics engine.
- Storage: File System Access API where available, plain file download/upload
  fallback. A palace should be a folder the user can zip and back up.
- Must run from `file://` or a trivial static server. No build step required to use.

## Build order

1. Load a GLB, walk around it in first person. Nothing else.
2. Drop, select, move, delete loci. Render them as simple glowing markers.
3. Save/load the palace JSON. Verify a GLB swap preserves locus positions.
4. Review mode: teleport to each locus in order, prompt, reveal on keypress.
5. Text-only mnemonics working end to end. **Ship here — this is a usable tool.**
6. Generation backend interface + the `none` and `byo-key` implementations.
7. Local TRELLIS backend.
8. Nested child palaces.

Do step 1 and stop for review before going further.

## Style notes

- Prefer boring, readable code over clever code. This will be read by hobbyists.
- Comment the *why* on anything spatial or coordinate-related.
- No dependency gets added without a one-line justification in the commit message.
