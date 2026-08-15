---
id: 5
title: Publish a palace for review on another device
status: backlog
priority: low
created: 2026-08-15T15:26:12.494871372-04:00
updated: 2026-08-15T18:40:09.661987204-04:00
tags:
    - sync
    - nice-to-have
class: standard
---

Options to evaluate, cheapest-infra first: (1) compressed URL hash for slim palaces + QR code to hop desktop->phone; (2) BYO GitHub token -> private gist (GitHub API is CORS-open, zero infra for us); (3) BYO cloud drive via OAuth PKCE (Dropbox/Drive appdata); (4) a small hosted service (Cloudflare Worker + R2) giving anonymous publish URLs. Keep local-first: publishing must stay opt-in.
