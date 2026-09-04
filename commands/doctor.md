---
description: Check the staff-engineer installation and list open questions for the operator.
---

Run `node .staff-engineer/cli.mjs doctor --json --which`.

- If checks fail, fix them (usually by rerunning the installer).
- For each open question, ask the operator one question at a time in plain language and record the answer with `node .staff-engineer/cli.mjs config set gates.<name>.cmd "..."` or `node .staff-engineer/cli.mjs config set gates.<name> null` when not applicable.
- Summarize the health in one or two plain sentences.
