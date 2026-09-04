---
description: Record the operator's clear acceptance of the preview and unlock finishing work.
---

Only when the operator clearly accepted the preview (for example "looks good"). Praise for one part, a question, or a change request is not acceptance.

`STAFF_ENGINEER_PREVIEW_APPROVED=1 node .staff-engineer/cli.mjs finalize --json`

Then follow the printed order: tests, `/staff-engineer:simplify`, docs, stage everything, `node .staff-engineer/cli.mjs lifecycle`, `node .staff-engineer/cli.mjs verify --mode full`, `/staff-engineer:handoff`. If finishing work changes anything the operator can see, run `/staff-engineer:revise` and return to the preview loop.
