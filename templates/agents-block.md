## Staff-engineer working agreement (toolkit {{version}})

This project uses the **staff-engineer** toolkit. The CLI enforces its lifecycle and save operations;
skills guide the work between them. Before changing anything, read `.agents/skills/staff-engineer/SKILL.md`.

- The **first workflow command** for every new concern is
  `node .staff-engineer/cli.mjs begin "Short concern"`. It checks upstream before opening a
  session. If it updates the toolkit, save that upgrade separately and restart; never update in
  the middle or at the end of a concern.
- Agree the outcome with the operator first (`grill-me` skill), record it with `brief`, then run
  `context <planned files>` and read its packet before editing.
- Build the smallest working first pass with useful regression tests, then `preview` and **stop for
  feedback**. Existing tests and focused regressions may run early. Simplification, final docs,
  lifecycle, and full verification wait for acceptance. Preview refuses empty work.
- After clear acceptance: `STAFF_ENGINEER_PREVIEW_APPROVED=1 node .staff-engineer/cli.mjs finalize`,
  then complete coverage, the `simplify` skill, docs, `lifecycle`, and `verify --mode full` once.
- Ask for approval with the `handoff` skill. Only after "ship it":
  `STAFF_ENGINEER_CHANGE_APPROVED=1 node .staff-engineer/cli.mjs ship "Imperative message"`.
- Test value is a contract: name the failure, prove state transitions, and inventory unique
  coverage before removing tests. Follow the `solid` skill; never pad tests to satisfy a gate.
- Never bypass a failed gate. Never stage secrets, environment files, logs, or generated output.
- Speak to the operator in plain language; see the `handoff` and `data-safety` skills.

Configuration: `.staff-engineer/config.json`. Health check: `node .staff-engineer/cli.mjs doctor`.
