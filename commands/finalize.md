---
description: Record the operator's clear acceptance of the preview and unlock finishing work.
---

Only when the operator clearly accepted the preview (for example "looks good"). Praise for one part, a question, or a change request is not acceptance. Quote their reply verbatim:

`node .staff-engineer/cli.mjs finalize --approval-quote "<the operator's exact words>" --json`

Then follow the printed next step. In the trivial lane that acceptance also approves the save while the source stays unchanged. If finishing work changes anything the operator can see, run `/staff-engineer:revise` and return to the preview loop.
