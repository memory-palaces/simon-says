---
id: 10
title: 'Image providers: Gemini'
status: review
priority: low
created: 2026-08-15T15:26:12.593545474-04:00
updated: 2026-08-15T18:45:01.125764024-04:00
started: 2026-08-15T18:45:01.126774352-04:00
tags:
    - generation
claimed_by: frigates-coexist
claimed_at: 2026-08-15T18:45:01.125764024-04:00
class: standard
---

POST https://generativelanguage.googleapis.com/v1beta/interactions with x-goog-api-key. CORS echoes the origin. Body {model: gemini-3.1-flash-image, input:[{type:text,text}], response_format:{type:image,...}}. Base64 at steps[].content[].data where type==image. Doc-derived, not observed — verify against a live key before shipping.

Shipped; request shape is doc-derived. Preflight + auth error verified from a live page, but no successful render observed without a real key.
