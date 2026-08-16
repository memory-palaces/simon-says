---
id: 16
title: Render-image button appeared only after leaving and re-entering the world
status: done
priority: high
created: 2026-08-15T23:48:48.529271935-04:00
updated: 2026-08-15T23:48:48.529271935-04:00
tags:
    - bug
    - ux
class: standard
---

The prompt field updates with rerender=false to keep focus, so the generate block (which only exists once there IS a prompt) was never rebuilt. Now that one block is swapped in place the moment the field stops/starts being empty — button appears on the first keystroke, focus stays in the textarea.
