---
description: Run the project's configured checks through the staff-engineer wrapper (fast or full).
---

`node .staff-engineer/cli.mjs verify --mode ${ARGUMENTS:-fast} --json`

- fast: format, lint, typecheck, tests (affected when configured). It may run during implementation for early feedback.
- full: adds build and end-to-end; writes the receipt the guarded save requires. Run it once on the final staged batch; rerun if executable code, tests, rules, configuration, dependencies, or toolkit runtime changed afterwards. Prose-only documentation, managed agent instructions, and skill prose keep it valid.
- `{files}` in an affected-test command must be one top-level token outside quotes, with a simple static runner command. Shell command-evaluation templates such as `sh -c`, `eval`, and Windows `call` are unsupported. The wrapper passes paths as shell-safe environment values.
- On failure, read the focused report and fix the cause. Never add retries, weaken a check, or call a test flaky. Never rerun "to be safe".
