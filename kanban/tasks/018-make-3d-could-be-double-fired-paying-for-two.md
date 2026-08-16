---
id: 18
title: Make 3D could be double-fired, paying for two renders
status: done
priority: high
created: 2026-08-15T23:58:33.058334247-04:00
updated: 2026-08-15T23:58:33.058334247-04:00
tags:
    - bug
    - 3d
class: standard
---

No busy state: a second click while a job ran queued another. main.ts now tracks in-flight jobs by target key (locus/prop/decor/portal); the button renders '⏳ Making 3D…', disabled, until it finishes. Guard is enforced in both the UI and imageTo3d().
