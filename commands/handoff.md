---
description: Draft the plain-language handoff and ask the operator for approval to save.
---

Read the `handoff` skill. Run `node .staff-engineer/cli.mjs handoff --json`, fill any placeholders in plain language, and send it. In Final approval or Guided mode, stop and wait. In Through delivery, use the
handoff as a summary and continue to ship without an approval quote. When approval is required, only an explicit "ship it" sent after this handoff authorizes `/staff-engineer:ship` (quote it with `--approval-quote`); "hold" pauses further actions; a change request returns to implementation. Never split approval into separate save and deploy questions.
