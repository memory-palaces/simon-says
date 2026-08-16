---
id: 21
title: 'Aim at me: re-point a locus''s anchor at the camera'
status: done
priority: high
created: 2026-08-16T07:58:25.782738438-04:00
updated: 2026-08-16T07:58:25.782738438-04:00
tags:
    - ux
    - 3d
class: standard
---

A locus stores the surface normal it was dropped on; everything attached hangs off that direction. Land on a doorframe edge or an angled face and the whole tableau sits skewed (the 'rendered far to the right' report). One click now sets local_normal to face the camera. Chosen over adding rotate-X/Y/Z sliders for the anchor: same power, no extra clutter, and it matches how people actually judge placement — by standing where they want to see it from.
