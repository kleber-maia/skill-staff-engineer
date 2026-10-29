---
description: Present the working result to the operator and read the acceptance checks back.
---

Make sure the preview is running (for web projects start the configured command in the background and wait until the address responds). Then run:

`node .staff-engineer/cli.mjs preview --json`

In Final approval and Through delivery, exercise the result and inspect affected
visuals, then record `acceptance <evidence.json>` and continue with `next`; do not
wait for operator preview acceptance.

In Guided mode, send the operator line as-is (plain language, no file names or commands). Then STOP and wait for feedback. Do not continue editing while feedback is open. On change requests run `/staff-engineer:revise`, update code and regression tests, and preview again; on clear acceptance run `/staff-engineer:finalize`.
