---
description: Draft the plain-language handoff and ask the operator for approval to save.
---

Read the `handoff` skill. Run `node .staff-engineer/cli.mjs handoff --json`, fill any placeholders in plain language, and send it. Then STOP and wait. Only an explicit "ship it" authorizes `/staff-engineer:ship`; "hold" or any change request returns to work. Never split approval into separate save and deploy questions.
