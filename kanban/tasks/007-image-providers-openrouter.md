---
id: 7
title: 'Image providers: OpenRouter'
status: done
priority: high
created: 2026-08-15T15:26:12.530515056-04:00
updated: 2026-08-15T18:44:41.955272464-04:00
started: 2026-08-15T18:44:41.956029096-04:00
completed: 2026-08-15T18:44:41.956029096-04:00
tags:
    - generation
class: standard
---

Research verified: POST https://openrouter.ai/api/v1/images, Bearer key, CORS allow-origin *. Body {model, prompt, n, seed, output_format, input_references[] (accepts data URLs)}. Image at data[].b64_json + media_type. 45 image models behind one key (gpt-image, gemini flash image, flux, seedream, qwen...). Also offers OAuth PKCE so users need not paste a raw key. Best single addition.
