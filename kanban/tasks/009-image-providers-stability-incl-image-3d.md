---
id: 9
title: 'Image providers: Stability (incl. image->3D)'
status: review
priority: medium
created: 2026-08-15T15:26:12.570873442-04:00
updated: 2026-08-15T18:45:01.101255683-04:00
started: 2026-08-15T18:45:01.102612702-04:00
tags:
    - generation
    - 3d
claimed_by: frigates-coexist
claimed_at: 2026-08-15T18:45:01.101255683-04:00
class: standard
---

POST /v2beta/stable-image/generate/core, Bearer key, multipart/form-data (mandatory), Accept: application/json -> {image: base64, seed, finish_reason}. CORS-open. Bonus: /v2beta/3d/stable-fast-3d returns model/gltf-binary SYNCHRONOUSLY — a second image->3D path next to fal.ai TRELLIS. Data URLs must be converted to Blob first.

Text-to-image shipped and CORS-verified from a live page. Still to do: wire imageTo3d into the UI 3D step (backend method exists, can3d=true).
