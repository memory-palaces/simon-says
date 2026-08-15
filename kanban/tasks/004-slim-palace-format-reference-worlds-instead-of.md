---
id: 4
title: Slim palace format (reference worlds instead of embedding)
status: backlog
priority: low
created: 2026-08-15T15:26:12.476270862-04:00
updated: 2026-08-15T18:40:09.661482607-04:00
tags:
    - format
    - sync
    - nice-to-have
class: standard
---

A 2-locus palace with nested portals is currently 19.3 MB: 5.8 MB meshes + 0.74 MB images + 1.4 MB base64 GLB, all embedded. If a palace can reference a bundled world by id (and generated assets optionally by URL), a text-only palace becomes a few KB — which is what makes URL sharing, gists, and cross-device sync practical. This is the enabling change for everything in the sync epic.
