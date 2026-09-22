---
description: Open exactly one staff-engineer work session for a single concern.
---

Read the `staff-engineer` skill. Before inspecting, interviewing, or changing the project, run:

`node .staff-engineer/cli.mjs begin "$ARGUMENTS" --lane <trivial|standard|large>`

Pick `trivial` only for obvious, low-risk edits (copy, a style tweak, a one-line fix); `large` for more than two areas, new data shapes, or more than a day; otherwise `standard`.

This command checks the recorded upstream repository before it creates any session. If it installs
an update, keep and save the toolkit upgrade separately, then restart this concern; do not continue
under the old process. If the check fails, fix access or run `/staff-engineer:update --from ...`,
then retry. If it refuses because a session is open, finish or abort that concern first. After it
opens, follow the printed next step (`/staff-engineer:next` at any time).
