---
name: code-review
description: Review a change for bugs, regressions, edge cases, and missed requirements, plus cleanup (the simplify lenses), at the level the toolkit requires (minimum, standard, detailed). Use when next or the review command asks for it, after the operator accepted the preview (before the preview in the trivial lane).
license: MIT
metadata:
  version: "1.0.0"
---

# Code Review

A review exists to stop bugs, regressions, missed edge cases, and missed requirements
from being saved. Cleanup (the `simplify` lenses) rides along. The toolkit picks the
level: the lane sets the base, and risky paths (stored data, sign-in, money, public
interfaces, background work, large changes) raise it. Never pick a lower level to save
effort; if a lower level is honestly enough, say why with `review done --reason`.

## Flow

1. Finish tests and the docs that describe the change first; the review checks them.
2. `node .staff-engineer/cli.mjs review` writes a packet (brief, acceptance checks,
   changed files, tests, callers of changed code, and the diff) and says who reviews.
   After a previous review, the packet holds only the **delta**: review just that.
3. Review at the level printed (below). Reviewers work from the packet and open files
   only to confirm a finding; they do not crawl the repository.
4. Act on findings (see Applying), then record the result:
   `node .staff-engineer/cli.mjs review done --found <n> --fixed <n> [--reported <n>]`.
5. If fixes change code later, `next` asks for another review; it covers only the delta.

## Levels

**minimum** (you, no subagents). Walk the packet once:
- Each acceptance check: point to the code that satisfies it. A check with no code is a
  missed requirement.
- Edge cases on changed lines: empty, missing, zero, negative, very large, duplicate,
  unauthorized, offline, and the error path.
- Each listed caller: does it still work with the new behavior or signature?
- Tests: do they fail if the change were reverted? Is the error path covered?
- Quick cleanup pass with the four lenses on the diff only; apply SAFE findings only.

**standard** (one fresh-context reviewer). Hand the packet path to one reviewer (the
`reviewer` agent with focus `all`, or your harness's subagent). Do not read the packet
yourself; the reviewer's independence is the point. Any subagent works if told to follow
`reviewer.md` in this skill's folder. It covers everything in minimum,
more deeply, plus contracts and data flow through the callers, and all four cleanup
lenses (searching the codebase only for reuse candidates near the change). Without
subagents, do one deliberate pass yourself in this order, and say so.

**detailed** (parallel specialists, then refutation). Launch in parallel, each with the
packet path: `reviewer` with focus `correctness`, `requirements`, and `regressions`
(plus `security` when data, sign-in, or money is involved), and the four `simplify-*`
lenses. Then give every bug, regression, requirement, and security finding to
`review-refuter` (instructions: `review-refuter.md` in this skill's folder), which tries to disprove it. Act only on findings that survive.

## Finding format

```
file:line  kind: bug|regression|requirement|security|cleanup  what fails: <concrete scenario>  fix  confidence: high|medium|low  risk: SAFE|CAREFUL|RISKY
```

A finding without a `file:line` and a concrete scenario (inputs or state leading to the
wrong result) is dropped. Style preferences are not findings.

## Applying

1. Merge duplicates. Resolve conflicts: correctness, then the brief, then readability.
2. Fix every surviving bug, regression, requirement, and security finding, with a test
   that fails without the fix where practical.
3. Cleanup: apply SAFE, then CAREFUL one file at a time with
   `node .staff-engineer/cli.mjs verify --mode fast` after each; revert any that break.
   Report RISKY ones instead of applying them.
4. If a fix changes what the operator sees, run `revise` and preview again.
5. Record counts honestly: found = surviving findings, fixed = applied, reported = left
   for the operator or a later concern. Mention reported ones in the handoff.
