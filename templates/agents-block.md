## Staff-engineer working agreement (toolkit {{version}})

This project uses the **staff-engineer** toolkit. The CLI enforces its lifecycle and save operations;
skills guide the work between them. Before changing anything, read `.agents/skills/staff-engineer/SKILL.md`.

- **Toolkit maintenance is not a concern.** Installing, updating, configuring, or removing the
  toolkit uses `install`, `update`, `config`, `settings`, and `save-toolkit` only; never `begin`,
  a brief, a preview, a review, or `ship` for toolkit files.
- **You run every command; the operator never does.** Run `node .staff-engineer/cli.mjs next`
  whenever unsure: it prints the one next step, the skills to read now, and whether to wait for
  the operator.
- The **first workflow command** for every new concern is
  `node .staff-engineer/cli.mjs begin "Short concern" --lane trivial|standard|large`. It checks
  for toolkit updates at most once a day and saves a clean upgrade as its own change. Pick
  `trivial` only for obvious, low-risk edits; when unsure, `standard`.
- Never re-ask a decision `begin` or `context` lists as earlier. Record new ones with
  `brief --decision "Topic: choice"`; `ship` saves them to `.staff-engineer/decisions.json`.
- When the operator asks to change how you work on this machine, use `settings set`; settings
  are local and never committed.
- Build the smallest working first pass, then `preview` and **stop for feedback**. The code review,
  final docs, lifecycle, and full verification wait for acceptance (trivial work finishes tests,
  docs, and its minimum review before its preview).
- Bug reports open with `begin "..." --bug`; the fix needs `repro`: a test that fails on the original
  code and passes on the fixed code.
- Every code change is reviewed at the level `review` prints (minimum, standard, detailed; follow
  the `code-review` skill). Fixes after a review need only a delta review.
- Approvals quote the operator verbatim, from a reply sent after that step was presented:
  `finalize --approval-quote "<their words>"` after preview acceptance, and
  `ship "Imperative message" --approval-quote "<their words>"` after they approve the handoff.
  Never invent or paraphrase approval.
- Test value is a contract: name the failure, prove state transitions, and inventory unique
  coverage before removing tests. Follow the `solid` skill; never pad tests to satisfy a gate.
- Never bypass a failed gate. Never stage secrets, environment files, logs, or generated output.
- Speak to the operator in plain language; see the `handoff` and `data-safety` skills.

Configuration: `.staff-engineer/config.json`. Health check: `node .staff-engineer/cli.mjs doctor`.
