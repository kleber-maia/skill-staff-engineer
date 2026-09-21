---
description: Upgrade the vendored staff-engineer toolkit in this project from its recorded source or a given path/URL.
---

Run `node .staff-engineer/cli.mjs update $ARGUMENTS --json` (add `--from <path|git-url>` to override the recorded repository URL, or `--dry-run` to preview). Only toolkit-owned files change. Normal concern starts perform this check automatically as the first `begin` step; never run it during an open concern. Afterwards run `/staff-engineer:doctor` and tell the operator in one plain sentence what was updated. Save the upgrade as its own change.
