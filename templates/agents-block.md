## Staff-engineer working agreement (toolkit {{version}})

This project uses the **staff-engineer** toolkit. Scripts enforce the agreement; prose alone is
not enough. Before changing anything, read `.agents/skills/staff-engineer/SKILL.md`.

- Work on **one concern at a time**: `node .staff-engineer/cli.mjs begin "Short concern"`.
- Agree the outcome with the operator first (`grill-me` skill), record it with `brief`, then run
  `context <planned files>` and read its packet before editing.
- Build the smallest working first pass, then `preview` and **stop for feedback**. No tests,
  review, simplification, docs, or verification before the operator accepts the preview.
- After clear acceptance: `STAFF_ENGINEER_PREVIEW_APPROVED=1 node .staff-engineer/cli.mjs finalize`,
  then tests, the `simplify` skill, docs, `lifecycle`, and `verify --mode full` once.
- Ask for approval with the `handoff` skill. Only after "ship it":
  `STAFF_ENGINEER_CHANGE_APPROVED=1 node .staff-engineer/cli.mjs ship "Imperative message"`.
- Never bypass a failed gate. Never stage secrets, environment files, logs, or generated output.
- Speak to the operator in plain language; see the `handoff` and `data-safety` skills.

Configuration: `.staff-engineer/config.json`. Health check: `node .staff-engineer/cli.mjs doctor`.
