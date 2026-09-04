---
name: simplify
description: Four-lens cleanup review (Reuse, Quality, Efficiency, Altitude) of an accepted change before it is saved. Use only after the operator accepted the preview and the session is finalizing; it reduces duplication, complexity, waste, and wrong-depth fixes, then identifies documentation impact.
license: MIT
metadata:
  version: "1.0.0"
  upstream:
    source: NousResearch/hermes-agent
    path: skills/software-development/simplify-code/SKILL.md
    adapted: true
    reason: Kept the four reviewer lenses, finding format, and risk tiers; generalized the apply loop to the toolkit's finalization phase, fast verification, and staged lifecycle gate so it works in any project.
---

# Simplify

Use this skill only after the operator has accepted the working preview and the
session is in the `finalizing` phase (`node .staff-engineer/cli.mjs status`). Never
simplify an unreviewed first pass. This is a cleanup of code that already works: make
the change smaller, clearer, and easier to maintain without changing the visible
outcome. It is not a bug hunt. If a lens finds a real bug, report it separately and
prominently.

## Inputs

- The brief's outcome in one sentence.
- The complete diff of the concern against the session's base, plus the file list.
- The checks already run and any failures fixed.

## The four lenses

Run all four over the complete diff. On harnesses with subagents, run the four
lenses concurrently, each with the whole diff and read access to the repository; the
Claude plugin ships them as the `simplify-reuse`, `simplify-quality`,
`simplify-efficiency`, and `simplify-altitude` agents. Otherwise run them
sequentially yourself and say so in the summary. Each lens must search the codebase
for evidence; a finding without a `file:line` pointer is noise and is dropped.

**Reuse.** New code that duplicates something the repository already has: helpers,
constants, schemas, UI primitives, services. Name the existing thing and where it
lives.

**Quality.** Redundant or derivable state, parameters bolted on where a restructure
was due, near-duplicate blocks, leaky abstractions, raw strings where a registry
exists, nested conditionals that want guard clauses, comments that restate code,
defensive checks on already validated input, weakened types.

**Efficiency.** Repeated computation or reads, sequential work that could run
concurrently, heavy work on request or startup paths, check-then-act races,
unbounded growth or missing cleanup, overly broad reads, silently swallowed errors.

**Altitude.** Fixes made at the wrong depth: a special case in a shared path for one
caller, a symptom patched at one call site while siblings keep the flaw, a
workaround on a workaround, a wrapper added to avoid touching the real owner. Name
the deeper fix and say honestly when it is large enough to be its own concern.

## Finding format

```
file:line  problem  cost  suggested fix  confidence: high|medium|low  risk: SAFE|CAREFUL|RISKY
```

- **cost** states what the problem costs: duplication, maintenance, waste, or
  confusion. A finding that cannot state its cost is a nit; skip it.
- **SAFE** cannot change behavior: unused imports, dead code, pass-through wrappers.
- **CAREFUL** improves without changing semantics: renames, flattening, extracting a
  local helper, consolidating duplicates.
- **RISKY** may change behavior or a public contract: API renames, data shape,
  concurrency, error handling.

Apply Chesterton's Fence: before removing anything, read the surrounding code and
its history. If the reason for a line is unclear, mark the finding low confidence
rather than deleting it.

## Applying findings

1. Merge overlapping findings and drop the weak ones. You have the most context.
2. Resolve conflicts in this order: correctness, then the brief's outcome, then
   readability and reuse, then micro-performance.
3. Apply **SAFE** findings, then run `node .staff-engineer/cli.mjs verify --mode fast`.
4. Apply **CAREFUL** findings one file at a time with the fast check after each.
   Revert any that break.
5. Do not apply **RISKY** findings in this pass. Report each with its risk and test
   coverage so the operator or a later concern can decide.
6. If any applied fix changes visible or interactive behavior, run
   `node .staff-engineer/cli.mjs revise` and return to the preview loop before
   continuing.

Keep edits inside what the diff touched plus the minimal surrounding change a fix
needs. This is not a license to refactor the module.

## Documentation impact

Ask whether the change altered anything documentable: setup, configuration,
commands, routes or endpoints, data shape, integrations, or operator instructions.
Update the docs that describe the changed behavior in the same batch. If no docs
are needed, be ready to say why in the handoff; the `lifecycle` gate will ask.

## Summary

End with a short list of applied fixes grouped by lens and risk tier, the RISKY
findings left for review, any bug found, whether the lenses ran in parallel or
inline, and the documentation impact decision.

## Script backstop

```bash
node .staff-engineer/cli.mjs lifecycle
```

The staged lifecycle gate catches debug code, suppressions, loose types, unfinished
markers, broad helper files, oversized files, missing documentation, and missing
tests. The `ship` command runs it too. Fix findings; do not bypass them.
