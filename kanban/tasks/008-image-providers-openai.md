---
id: 8
title: 'Image providers: OpenAI'
status: done
priority: medium
created: 2026-08-15T15:26:12.552311175-04:00
updated: 2026-08-15T18:44:41.995413613-04:00
started: 2026-08-15T18:44:41.996638143-04:00
completed: 2026-08-15T18:44:41.996638143-04:00
tags:
    - generation
class: standard
---

Verified CORS-open (access-control-allow-origin: *) despite the SDK's dangerouslyAllowBrowser warning. POST https://api.openai.com/v1/images/generations, Bearer key, {model: gpt-image-1.5, prompt, n, size}. GPT image models ALWAYS return base64 at data[].b64_json (response_format is dall-e-only). /v1/images/edits now takes JSON with image_url accepting data URLs (20 MB cap).
