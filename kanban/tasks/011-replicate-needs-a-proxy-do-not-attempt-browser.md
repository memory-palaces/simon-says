---
id: 11
title: 'Replicate: needs a proxy (do not attempt browser-direct)'
status: backlog
priority: low
created: 2026-08-15T15:26:12.615823397-04:00
updated: 2026-08-15T15:26:12.615823397-04:00
tags:
    - generation
    - research
class: standard
---

Confirmed empirically: no access-control-* headers at all on api.replicate.com, so the browser blocks it. Also async (create + poll), a poor fit for a static app. Only viable if we ever run a server.
