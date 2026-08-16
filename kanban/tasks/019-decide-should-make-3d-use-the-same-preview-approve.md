---
id: 19
title: 'Decide: should Make 3D use the same preview/approve modal as image render?'
status: backlog
priority: low
created: 2026-08-15T23:58:33.083573985-04:00
updated: 2026-08-15T23:58:33.083573985-04:00
tags:
    - ux
    - 3d
class: standard
---

Today: Render image opens a modal (reroll / use this image); Make 3D runs in the background with a toast. Deliberate — a 3D render can take a minute and a blocking modal would trap you — but it does read as inconsistent. Options: (a) status quo + busy button (shipped), (b) route the finished mesh into an approve/discard dialog with the existing MeshPreview, (c) make image render async too. Wants a real decision, not drift.
