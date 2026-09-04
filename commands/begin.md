---
description: Open exactly one staff-engineer work session for a single concern.
---

Read the `staff-engineer` skill. Then run:

`node .staff-engineer/cli.mjs begin "$ARGUMENTS"`

If it refuses because a session is open, finish or abort that concern first. After it opens, interview the operator with the `grill-me` skill (skip it only for a trivially clear request and say so), then record the brief with `/staff-engineer:brief`.
