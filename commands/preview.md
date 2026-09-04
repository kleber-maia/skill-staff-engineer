---
description: Present the working result to the operator and read the acceptance checks back.
---

Make sure the preview is running (for web projects start the configured command in the background and wait until the address responds). Then run:

`node .staff-engineer/cli.mjs preview --json`

Send the operator line as-is (plain language, no file names or commands). Then STOP and wait for feedback. Do not write tests, review, simplify, document, or verify while feedback is open. On change requests run `/staff-engineer:revise`; on clear acceptance run `/staff-engineer:finalize`.
