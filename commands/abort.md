---
description: Close an abandoned staff-engineer work session without deleting any files.
---

Run `node .staff-engineer/cli.mjs abort --json`. If it reports pending files, ask the operator whether to keep or drop that work; only then run `node .staff-engineer/cli.mjs abort --discard-confirmed`. Never delete or revert files as part of aborting.
