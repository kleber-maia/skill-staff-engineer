---
description: Save the verified batch as one commit after the operator replied "ship it".
---

In Through delivery mode, run `ship` without an approval quote after current
acceptance evidence, review, checks, and handoff. Otherwise, only after the operator explicitly approved the handoff (or, in the trivial lane, the unchanged preview). Quote their reply verbatim:

`node .staff-engineer/cli.mjs ship "$ARGUMENTS" --approval-quote "<the operator's exact words>" --json`

Saving includes confirmed delivery when the project has a remote. On delivery failure run `ship --sync-only` to retry the same commit; do not create another commit or force-push. Use `shipping.mode: "local"` only for intentional local work. If it refuses (lifecycle finding, stale receipt, no handoff for this batch, too many areas), fix the cause; never bypass. For more than the allowed number of areas, only with the operator's explicit cohesive authorization set `STAFF_ENGINEER_BROAD_CHANGE_REASON="..."`. Follow `next` through any configured `deploy` before reporting completion. Report the outcome in plain language.
