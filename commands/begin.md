---
description: Open exactly one staff-engineer work session for a single concern.
---

Read the `staff-engineer` skill. Before inspecting, interviewing, or changing the project, run:

`node .staff-engineer/cli.mjs begin "$ARGUMENTS" --lane <trivial|standard|large>`

Pick `trivial` only for obvious, low-risk edits (copy, a style tweak, a one-line fix); `large` for more than two areas, new data shapes, or more than a day; otherwise `standard`.

When a check is due (daily by default), this command first checks the recorded upstream repository.
A clean upgrade is saved as its own change and the session opens on the refreshed toolkit. If it
stops because toolkit files had unsaved edits, save the upgrade separately and run it again. If it
refuses because a session is open, finish or abort that concern first. Apply any earlier decisions
and "From recent work" guidance it prints. After it
opens, follow the printed next step (`/staff-engineer:next` at any time).
