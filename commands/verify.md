---
description: Run the project's configured checks through the staff-engineer wrapper (fast or full).
---

`node .staff-engineer/cli.mjs verify --mode ${ARGUMENTS:-fast} --json`

- fast: format, lint, typecheck, tests (affected when configured). Use while finishing.
- full: adds build and end-to-end; writes the receipt the guarded save requires. Run it once on the final staged batch; rerun only if code, tests, config, or dependencies changed afterwards.
- On failure, read the focused report and fix the cause. Never add retries, weaken a check, or call a test flaky. Never rerun "to be safe". If it refuses because tests wait for feedback, run the preview loop first.
