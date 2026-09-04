---
description: Build the staff-engineer task-context packet for the files you plan to change (skills by phase, related docs and tests, imported modules).
---

After the brief and before editing, run:

`node .staff-engineer/cli.mjs context $ARGUMENTS --json`

(With no arguments it uses the open concern's changed files.) Read every skill it lists, in order, then the related docs and tests, then the imported modules. Rerun it whenever the planned scope or the local imports grow. The lifecycle gate refuses the batch if a listed skill changed after the packet was built.
