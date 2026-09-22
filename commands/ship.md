---
description: Save the verified batch as one commit after the operator replied "ship it".
---

Only after the operator explicitly approved the handoff (or, in the trivial lane, the unchanged preview). Quote their reply verbatim:

`node .staff-engineer/cli.mjs ship "$ARGUMENTS" --approval-quote "<the operator's exact words>" --json`

Add `--push` when the project has a remote and the operator expects the change to be shared. If it refuses (lifecycle finding, stale receipt, no handoff for this batch, too many areas), fix the cause; never bypass. For more than the allowed number of areas, only with the operator's explicit cohesive authorization set `STAFF_ENGINEER_BROAD_CHANGE_REASON="..."`. Report the outcome in plain language.
