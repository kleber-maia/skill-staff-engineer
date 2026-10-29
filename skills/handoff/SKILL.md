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

## Mode

Follow the task’s recorded autonomy mode. Final approval (the default) asks once
after agent acceptance evidence, review, and full verification. Through delivery
uses the handoff as a summary and continues to `ship` without an approval quote.
Guided mode retains operator preview acceptance and save approval. The approval
rules below apply when the selected mode requires approval. If deployment is
configured, name its environment in the summary and approval question.

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
- If the operator replies "hold", record `autonomy hold` and pause further actions. If they ask for a
  change, run `revise`, return to the preview loop, and hand off again later.

## Template

Fill every applicable line. In autonomous mode replace the approval question with
a statement that you are proceeding to the configured delivery destination.

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
- review findings reported but not fixed (RISKY cleanups, out-of-scope issues);
- the commands the operator can run to reproduce the checks.

Ask before saving when the selected mode requires it. The technical operator gets more detail, not fewer gates.

## After approval

When approval is required, only an explicit "ship it" (or an unambiguous equivalent that clearly refers to the
handoff just sent) authorizes the save. You run it, quoting the operator's reply verbatim:

```bash
node .staff-engineer/cli.mjs ship "Imperative message" --approval-quote "<the operator's exact words>"
```

The CLI refuses an approval that predates this handoff or does not match what the operator
said (where the harness records their messages). The quote is saved in the commit.
Never ask the operator to type a command or a special phrase; their normal reply is enough.

Then relay `ship`'s operator line (it may include a short milestone) to confirm that the change is saved and delivery confirmed (or intentionally saved locally), without commands or hashes for a non-technical operator.

If delivery fails, keep the save pending and run `ship --sync-only` when the destination is available. This retries the same approved commit. Do not report the concern as finished while delivery is pending.

When `ship` reports deployment pending, run `deploy` and verify the live revision
before reporting the task complete. Git delivery alone is not deployment.
