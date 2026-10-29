## Staff-engineer working agreement (toolkit {{version}})

This project uses the **staff-engineer** toolkit. The CLI enforces its lifecycle and save operations;
skills guide the work between them. Before changing anything, read `.agents/skills/staff-engineer/SKILL.md`.

- **Toolkit maintenance is not a concern.** Installing, updating, configuring, or removing the
  toolkit uses `install`, `update`, `config`, `settings`, `autonomy`, and `save-toolkit` only; never `begin`,
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
- **Final approval is the default**, including existing installations. Relay `begin`'s
  prominent autonomy notice before working. Read the autonomy reference in the main
  skill. Interpret steering conversationally and record it with `autonomy --instruction`;
  use `--remember` only when asked to change the default. “Hold” pauses further actions.
- Build, run `preview`, exercise every acceptance criterion, inspect affected visuals,
  and record `acceptance <evidence.json>`. Then review, finish docs, run lifecycle and
  full verification. Guided mode instead waits for operator preview acceptance.
- Bug reports open with `begin "..." --bug`; the fix needs `repro`: a test that fails on the original
  code and passes on the fixed code.
- Every code change is reviewed at the level `review` prints (minimum, standard, detailed; follow
  the `code-review` skill). Fixes after a review need only a delta review.
- In Final approval, ask once after the final handoff. In Guided mode, obtain preview
  acceptance with `finalize` and save approval. Quote actual operator words with
  `--approval-quote`; never invent them. Through delivery uses the same verification
  and recorded autonomy authorization to `ship` without another question.
- Follow `next` through confirmed delivery and any configured `deploy`. Verify the
  delivered revision is live before reporting deployment complete.
- Test value is a contract: name the failure, prove state transitions, and inventory unique
  coverage before removing tests. Follow the `solid` skill; never pad tests to satisfy a gate.
- Never bypass a failed gate. Never stage secrets, environment files, logs, or generated output.
- Speak to the operator in plain language; see the `handoff` and `data-safety` skills.

Configuration: `.staff-engineer/config.json`. Health check: `node .staff-engineer/cli.mjs doctor`.
