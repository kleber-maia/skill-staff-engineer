---
name: spec-and-plan
description: Write a short specification and a checkbox plan before executing a large concern, get the operator's agreement in plain language, and keep the plan updated task by task. Use when a change touches more than two areas, needs new data shapes, or will take more than a day.
license: MIT
metadata:
  version: "1.0.0"
---

# Spec and Plan

Large concerns fail when the agent starts building before the shape of the change
is agreed. For anything that touches more than two areas, introduces new data
shapes, or will take more than a day, write the spec and the plan first.

## When to use

After `grill-me` and `brief`, if any of these is true:

- more than two areas of the project change (for example data model, service, and
  user interface);
- a new data shape, migration, or external integration is needed;
- the work will not finish in one sitting;
- the operator asked for a plan.

Otherwise skip this skill and build.

## Files

Use the templates the installer copied to `.staff-engineer/templates/` (the toolkit
keeps them at `templates/spec.md` and `templates/plan.md`). Name both files with
today's date and the concern slug:

- `docs/specs/<date>-<slug>.md`
- `docs/plans/<date>-<slug>.md`

Create the directories if they do not exist. These files are part of the concern and
are saved in the same batch.

## The spec

Keep it to one page. Sections:

- **Context:** the situation today and the pain, in the operator's words.
- **Decision:** what will be built, stated as outcomes and the surfaces that change.
- **Alternatives:** two or three options considered and why they lost, one line each.
- **Consequences:** what becomes easier, what becomes harder, what must be watched.
- **Acceptance:** the brief's acceptance checks, extended where the spec adds detail.

## The plan

Numbered tasks with checkboxes. Each task is small enough to finish and check in one
sitting and has:

- **Files:** the files or areas it touches.
- **Steps:** what to do, in order.
- **Verification:** how you will know the task is done (a check on the preview, a
  fast verify, a specific test).

```
- [ ] 1. <task title>
  - Files: <paths or areas>
  - Steps: <ordered steps>
  - Verification: <how this task proves itself>
```

Order tasks so the first working preview arrives as early as possible; the
operator sees something real before the deep work.

## Get agreement

Present the spec to the operator in plain language: what they will get, what it
will not do, and the main trade-off. A non-technical operator never needs to read
the file; summarize it and offer the file only if they want it. Ask one question:
does this match what you want? Adjust and re-ask until yes. Do not start the plan
before agreement.

## Execute

1. Work task by task in order. Mark a task `[x]` only when its verification passed.
2. Stop at the preview loop of the `staff-engineer` skill when the first usable
   result exists, even if later tasks remain. Acceptance there covers what is shown,
   not the whole plan.
3. If a task reveals the spec was wrong, update the spec, tell the operator what
   changed and why, and get agreement again before continuing.
4. Keep the plan honest: add tasks you discover, strike tasks that became
   unnecessary with a one-line reason.
5. When all tasks are checked, continue with finishing work, `handoff`, and the
   approved `ship`.

## Do not

- Do not write a spec for a small change; the brief is enough.
- Do not let the spec grow into a design document; one page, decisions only.
- Do not save the plan half-updated. A stale plan is worse than none.
