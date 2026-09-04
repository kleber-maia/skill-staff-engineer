---
description: Run the four-lens simplify review on the accepted concern's diff using parallel subagents.
---

Read the `simplify` skill. Only after finalize (operator accepted the preview).

1. Collect the concern's complete diff: `git diff` plus `git diff --cached` plus untracked files listed by `node .staff-engineer/cli.mjs status --json` (concernFiles).
2. Launch the four agents in parallel, each with the whole diff and the brief's outcome: `simplify-reuse`, `simplify-quality`, `simplify-efficiency`, `simplify-altitude`.
3. Merge findings, drop any without a `file:line` pointer, resolve conflicts in the skill's order.
4. Apply SAFE findings, run `node .staff-engineer/cli.mjs verify --mode fast`; apply CAREFUL findings one file at a time with the fast check after each; report RISKY findings without applying them.
5. If any fix changes visible behavior, run `/staff-engineer:revise` and return to the preview loop.
6. Summarize applied fixes by lens and tier, RISKY items left, bugs found, and the documentation impact decision.
