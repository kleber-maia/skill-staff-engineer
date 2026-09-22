---
description: Show or change this machine's staff-engineer preferences (self-check level, update checks). Never committed.
---

When the operator asks to change how you work here (for example "stop checking your own work" or "check for updates weekly"), run `node .staff-engineer/cli.mjs settings set <key> <value> --json`, then confirm in one plain sentence. With no arguments, `node .staff-engineer/cli.mjs settings --json` lists every setting, its value, and what it does.
