# Addendum A — Interoperable Export

Read alongside SPEC.md. This does not change the build order; treat it as a
milestone slotted in **after step 5** (text-only mnemonics working end to end).

## The problem

The palace format described in SPEC.md is a JSON manifest referencing external GLB
files. That is the right *authoring* format — it is diffable, hand-editable, keeps
loci in asset-local coordinates so geometry can be swapped, and supports nested
palaces. But no other program understands it. Handed our folder, a generic VR
walkthrough app or a 3D viewer sees a pile of disconnected GLBs and a JSON file it
ignores.

So we need two formats, in the same relationship as `.blend` to `.glb`:

- **Authoring format** — the JSON manifest + loose assets. Lossless, editable,
  supports everything. This stays the working format.
- **Delivery format** — a single self-contained `.glb` that any glTF-capable
  program opens. Lossy in the ways described below, and that is acceptable.

Never make the delivery format the working format. Baking is one-way.

## How to bake

Produce **one .glb** containing the whole palace as a single scene graph:

- Imported geometry assets become nodes under the scene root, with their
  transforms applied.
- Each locus becomes a **named empty node** positioned in world space, named
  `locus_001_kitchen_island` (order-prefixed so alphabetical sort = route order).
- Each generated mnemonic mesh becomes a child node of its locus node, so moving
  the locus in Blender moves its object.
- Textures, images and buffers are embedded, not referenced. One file, no
  sidecars. That is the entire point of GLB over glTF+bin.

Use three.js's `GLTFExporter` with `binary: true`. Do not hand-roll this.

## Metadata: use `extras`

glTF defines an `extras` field on every node, mesh and scene — an arbitrary JSON
object that the spec requires parsers to preserve or ignore, never to reject.
This is where our memory-palace data rides along.

On each locus node:

```jsonc
"extras": {
  "mp_type": "locus",
  "mp_order": 1,
  "mp_label": "Kitchen island, north corner",
  "mp_prompt": "a screaming lobster wearing my grandmother's reading glasses",
  "mp_child_palace": null
}
```

On the scene root, write an `mp_palace` object containing the palace name, format
version, and the full ordered route as a list of node names. That way the route
survives even if a tool mangles per-node extras.

**Namespace every key with `mp_`.** Extras is a shared junk drawer and other
exporters write to it.

What happens to extras downstream:

- **three.js** — surfaces them as `object.userData`. Round-trips cleanly.
- **Blender** — imports them as custom properties on the object, visible in the
  Object Properties panel, and re-exports them. This means a user can rearrange
  their palace in Blender and bring it back.
- **Generic VR viewers / game engines** — will almost certainly ignore extras and
  just render the geometry. That is the expected and acceptable outcome: the
  person still gets a walkable space with their weird objects sitting in it.

Because of that last point, **do not rely on extras for anything visible.** If a
locus needs to be perceptible in a dumb viewer, it needs actual geometry — see
the marker option below.

## Bake options to expose

- `--markers` — emit a small physical marker mesh at each locus (a low-poly
  numbered plinth or glowing sphere). Off by default, but essential if the target
  is a generic VR app that ignores extras. Without this, a text-only palace
  exports as an empty house.
- `--include-generated` — include generated mnemonic meshes. On by default.
- `--draco` — Draco mesh compression. Off by default; some viewers choke on it.
- `--y-up` — glTF is Y-up by convention already, but some targets want Z-up.
  Offer the flip rather than making the user fight it in Blender.

## Nested palaces — the honest limitation

A child palace inside a refrigerator is non-Euclidean. A single glTF scene has one
coordinate system and cannot represent that. There is no clever encoding that
fixes this; the format simply does not have the concept. Offer three strategies
via `--nested`:

1. **`separate` (default)** — export each palace as its own GLB. The parent's
   locus node carries `mp_child_palace: "fridge.glb"` in extras and, if markers
   are on, gets a visually distinct marker. Lossless, but a generic viewer shows
   only one level.
2. **`inline-scaled`** — shrink the child palace to fit inside its host locus and
   parent it there. Preserves the metaphor and opens in anything, but the child is
   no longer life-size, so it is decorative rather than walkable.
3. **`inline-offset`** — place the child at full scale, translated far away in
   world space (e.g. +1000m on X per nesting level). Everything is walkable and
   correctly sized; the spatial relationship is just gone, so a viewer sees
   floating islands. Most useful of the three for an actual VR walkthrough.

Document this tradeoff in the UI in one sentence. Do not try to hide it.

## Import — the return trip

Also implement **import of a baked GLB**. Read `mp_`-prefixed extras back out and
reconstruct the palace, falling back to parsing `locus_NNN_*` node names if extras
were stripped. This makes Blender a viable external editor for the whole palace and
means a user who only has the delivery file has not lost their work.

Round-trip test in the suite: bake → import → bake, and assert the two GLBs
produce equivalent palace JSON.

## Other formats

Do not build these. If asked:

- **USDZ** — what Apple's ecosystem wants. Convert from GLB with Meta's or Apple's
  existing converters rather than exporting it ourselves.
- **FBX** — proprietary, no metadata story worth having. Route users through
  Blender.
- **OBJ** — no scene graph, no metadata, no. Import only, never export.

GLB is the lingua franca. Export it well and let converters handle the rest.
