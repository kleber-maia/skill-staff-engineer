---
description: Review the concern for bugs, regressions, edge cases, missed requirements, and cleanup at the level the toolkit requires.
---

Read the `code-review` skill. Run `node .staff-engineer/cli.mjs review --json` and follow its instructions for the printed level:

- minimum: review the packet yourself with the minimum checklist.
- standard: give the packet path to one `reviewer` agent with focus `all`; do not read the packet yourself.
- detailed: in parallel, `reviewer` with focus `correctness`, `requirements`, `regressions` (and `security` when data, sign-in, or money is involved) plus `simplify-reuse`, `simplify-quality`, `simplify-efficiency`, `simplify-altitude`; then `review-refuter` on every non-cleanup finding.

Fix surviving findings, apply SAFE and CAREFUL cleanups with `verify --mode fast` between them, report RISKY ones, then run `node .staff-engineer/cli.mjs review done --found <n> --fixed <n> [--reported <n> --issue "file:line problem"]`, with one `--issue` per reported finding.
