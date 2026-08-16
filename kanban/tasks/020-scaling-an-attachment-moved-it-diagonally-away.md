---
id: 20
title: Scaling an attachment moved it diagonally away from its locus
status: done
priority: high
created: 2026-08-16T07:58:25.759139103-04:00
updated: 2026-08-16T07:58:25.759139103-04:00
tags:
    - bug
    - 3d
class: standard
---

Both the standoff (normal * 0.5 * scale) and the lift (y += 0.8 * scale) were multiplied by object_scale, so turning scale up translated the image/mesh up and out along the normal instead of just growing it. Standoff is now constant and the sprite is anchored by its BOTTOM edge (0.55 above the marker); mesh lift is constant too. Verified: bottom edge stays at 0.55 from scale 1 to 3.
