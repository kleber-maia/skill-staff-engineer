---
description: Present the working result to the operator and read the acceptance checks back.
---

Reuse a suitable running preview. When you start one, track its owned handle and how to try it with `resources track`, then wait for it to respond. Then run:

`node .staff-engineer/cli.mjs preview --json`

In Final approval and Through delivery, exercise the result and inspect affected
visuals, then record `acceptance <evidence.json>` and continue with `next`; do not
wait for operator preview acceptance.

In remote mode, attach durable proof and release the task-owned preview after inspection. In local mode, verify it is usable and give the operator access. In Guided mode, send the operator line with that evidence (plain language, no file names or commands). Then STOP and wait for feedback. Do not continue editing while feedback is open. On change requests run `/staff-engineer:revise`, update the working implementation and verify its behavior, and preview again; on clear acceptance run `/staff-engineer:finalize`.
