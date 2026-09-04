---
name: handoff
description: Write the plain-language handoff that asks the operator for approval to save a finished, verified change. Use at the end of every concern after lifecycle and full verification pass, and whenever reporting progress to a non-technical operator.
license: MIT
metadata:
  version: "1.0.0"
---

# Handoff

The handoff is the one message that turns a verified batch into a saved one. It
describes what changed in the operator's language and asks a single clear question.

Start from the draft the toolkit prints:

```bash
node .staff-engineer/cli.mjs handoff
```

It prefills the template from the brief (outcome, acceptance checks, non-goals,
surfaces) and the verification receipt. Finish every line before sending.

## Rules

- For a non-technical operator (`operator.mode` is `non-technical`), never expose
  commands, filenames, raw tool output, diffs, or internal steps. Describe outcomes:
  what the operator can now do or see.
- Acceptance is not approval. "Looks good" on the preview unlocked finishing work;
  it did not authorize saving.
- Praise is not approval. "Nice", "great", or a thumbs-up on one surface is not
  approval for the batch.
- Approval must follow a described change. Ask only after the operator has read
  what changed, what was checked, and what was left out.
- Ask once. Do not split approval into separate save and deploy prompts unless the
  project has a real deploy step; then name both in the same question.
- If a waiver was used (tests, docs, or a broad change), say so in plain words and
  why. Do not hide it in jargon.
- If the operator replies "hold", keep reviewing and do not save. If they ask for a
  change, run `revise`, return to the preview loop, and hand off again later.

## Template

Fill every line. Remove nothing.

```
What changed: <one or two sentences about what the operator can now do or see>.
What to look at: <preview link or how to see it>, then <surface or flow>; check <the brief's acceptance checks>.
What was checked: <plain description of the automated and manual checks>.
Left out on purpose: <non-goals from the brief, or "nothing">.
Is this finished and approved to save? Reply "ship it" to save it, or "hold" to keep reviewing.
```

Example for a non-technical operator:

```
What changed: You can now export your order history as a spreadsheet from the Orders page.
What to look at: <preview link>, then Orders; check that an Export button appears above the list, that the file opens with one row per order, and that only your own orders are in it.
What was checked: The automatic checks for formatting, code quality, and the full test suite all passed, including new tests for the export. I also opened the export on the preview and confirmed the three checks above.
Left out on purpose: Scheduled or emailed exports.
Is this finished and approved to save? Reply "ship it" to save it, or "hold" to keep reviewing.
```

Writing "What was checked" in plain words: say "automatic checks" for lint,
typecheck, format, and tests; "the full test suite" for the test gate; "a build of
the app" for the build gate; "an end-to-end run" for e2e. Name a waiver as "I did not
add a test for X because Y" or "No documentation needed a change because Y".

## Technical operator variant

When `operator.mode` is `technical`, keep the same five lines and the same single
question. You may add, after the template:

- a diff summary (files changed, tests added, notable design decisions);
- the exact gates that ran and their results, with the verify mode;
- RISKY simplify findings left for review;
- the commands the operator can run to reproduce the checks.

Still ask before saving. The technical operator gets more detail, not fewer gates.

## After approval

Only an explicit "ship it" (or an unambiguous equivalent that clearly refers to the
handoff just sent) authorizes:

```bash
STAFF_ENGINEER_CHANGE_APPROVED=1 node .staff-engineer/cli.mjs ship "Imperative message" [--push]
```

Then confirm in one sentence that the change is saved (and synced, if `--push` was
used), without commands or hashes for a non-technical operator.
