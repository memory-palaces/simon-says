---
id: 28
title: World geometry by URL (reference instead of embed)
status: done
priority: high
created: 2026-08-16T09:57:14.095440565-04:00
updated: 2026-08-16T09:57:14.095440565-04:00
tags:
    - format
    - worlds
class: standard
---

New-world picker now offers: built-in worlds (each showing its public URL), any GLB URL, or a file upload. URL worlds are referenced, so a palace on a shared world is a few KB. World settings gained a 'World geometry' block to swap the URL later (loci keep coordinates) and an 'Embed the model in exports' checkbox, default off. Verified cross-origin loads from raw.githubusercontent.com and GitHub Pages; a failed URL now clears the old model and says so instead of silently leaving the previous world on screen.
