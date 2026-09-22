---
description: Upgrade the staff-engineer toolkit in this project (maintenance, not a concern).
---

Run `node .staff-engineer/cli.mjs update $ARGUMENTS --json` (add `--from <path|git-url>` to override the recorded repository URL, or `--dry-run` to preview). It refuses during an open concern, changes only toolkit-owned files, and saves the upgrade as its own change. Do not run `begin`, a brief, a preview, a review, or `ship` for it. If it reports unsaved toolkit edits, review them and run `node .staff-engineer/cli.mjs save-toolkit`. Afterwards run `/staff-engineer:doctor` and tell the operator in one plain sentence what was updated. New concerns also check for updates on their own at `begin`.
