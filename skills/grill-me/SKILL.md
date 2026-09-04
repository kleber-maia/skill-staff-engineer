---
name: grill-me
description: Interview the operator about a requested change until every design branch is settled, then record a plain-language brief with the toolkit. Use before building any feature, workflow, or surface change whose outcome, scope, or acceptance is not already obvious.
license: MIT
metadata:
  version: "1.0.0"
  upstream:
    source: mattpocock/skills
    path: skills/productivity/grilling/SKILL.md
    adapted: true
    reason: Generalized for operators who may be non-technical, capped in questions and rounds, and ended by recording a brief the toolkit can read back at preview time.
---

# Grill Me

Interview the operator until you both share the same picture of the change. Do this
after opening the session and before editing code. Questions are about the result
the operator will see or use, never about how it is built, unless the operator is
technical and asks for trade-offs.

## When to skip

Skip the interview for a small, unambiguous request: a typo, a wording change, a
one-element style fix, or a request that already states the outcome and how to check
it. Say in one sentence that the request is clear and go straight to the brief.

## How the interview works

Treat the plan as a **design tree**. Each decision opens smaller decisions beneath
it. The **frontier** is the set of questions you can ask right now without guessing
at answers you have not heard yet.

Work in **rounds**:

1. Look up every fact yourself first: the codebase, the running preview, the README,
   existing surfaces, tests, and docs. Never ask the operator for anything you can
   find.
2. Ask the whole current frontier in one round: at most three questions, numbered,
   each with your recommended answer. The operator may answer any question with "go
   with your recommendation."
3. Wait for the answers. Settled decisions push the frontier outward and unblock the
   next questions. Recompute the frontier and ask the next round.
4. Stop when the frontier is empty or the operator says to proceed. Normally this
   takes no more than three rounds. If a third round still leaves open branches,
   recommend defaults for them and ask for one confirmation.

## What to ask about

- The outcome and the pain it removes.
- Which surface changes: a screen, a command, an API, a document, a report.
- Who uses it and how often.
- What "done" looks like on the preview: what the operator will click, run, or read
  to confirm it.
- What must not change.
- What is out of scope for this concern.
- For a technical operator only: technical trade-offs with real consequences
  (compatibility, data migration, performance budget). Never ask a non-technical
  operator about code, files, databases, frameworks, libraries, or tooling.

## Round format

```
Q1. <short title>
<one or two sentences of context, with choices when there are natural options>
Recommended: <your recommended answer and why, in one sentence>

Q2. <short title>
...
```

## The brief

When the frontier is empty, write the brief in plain language:

- **Outcome:** one sentence describing what the operator gets.
- **Acceptance:** two to five checks the operator can perform on the preview, each
  starting with a verb.
- **Non-goals:** what this change deliberately leaves alone.
- **Surfaces:** the screens, commands, APIs, or documents that will change.

Record it so `preview` and `handoff` can read it back:

```bash
node .staff-engineer/cli.mjs brief \
  --outcome "Customers can export their order history as a spreadsheet" \
  --accept "Open Orders and confirm an Export button appears above the list" \
  --accept "Export and confirm the file opens with one row per order" \
  --accept "Confirm orders from other accounts never appear in the file" \
  --non-goal "Scheduled or emailed exports" \
  --surface "Orders"
```

Repeat `--accept`, `--non-goal`, and `--surface` as needed. Confirm the brief to the
operator in one short message and start building. If feedback later narrows or
widens the goal, rerun `brief` with the updated content before `revise`.

## Do not

- Do not make it feel like an interrogation. Three questions with recommendations is
  the ceiling per round.
- Do not repeat a question the operator already settled, even in other words.
- Do not ask implementation questions of a non-technical operator. Decide those
  yourself with the `solid` skill.
- Do not delegate fact-finding to the operator. Look, then ask only about choices.
- Do not start building while a decision in the frontier is still open.
