---
id: 12
title: Warn about API-key exposure in the browser
status: done
priority: medium
created: 2026-08-15T15:26:12.638535425-04:00
updated: 2026-08-15T18:44:42.135255519-04:00
started: 2026-08-15T18:44:42.136233336-04:00
completed: 2026-08-15T18:44:42.136233336-04:00
tags:
    - generation
    - security
class: standard
---

Any key pasted into a static page is visible to devtools and travels in every request. Add a short note next to each key field; prefer OpenRouter OAuth PKCE where possible.
