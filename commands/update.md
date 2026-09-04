---
description: Upgrade the vendored staff-engineer toolkit in this project from its recorded source or a given path/URL.
---

Run `node .staff-engineer/cli.mjs update $ARGUMENTS --json` (add `--from <path|git-url>` when the recorded source is gone, or `--dry-run` to preview). Only toolkit-owned files change. Afterwards run `/staff-engineer:doctor` and tell the operator in one plain sentence what was updated. Suggest saving the upgrade as its own change.
