---
description: Open exactly one staff-engineer work session for a single concern.
---

Read the `staff-engineer` skill. Before inspecting, interviewing, or changing the project, run:

`node .staff-engineer/cli.mjs begin "$ARGUMENTS"`

This command checks the recorded upstream repository before it creates any session. If it installs
an update, keep and save the toolkit upgrade separately, then restart this concern; do not continue
under the old process. If the check fails, fix access or run `/staff-engineer:update --from ...`,
then retry. If it refuses because a session is open, finish or abort that concern first. After it
opens, interview the operator with the `grill-me` skill (skip it only for a trivially clear request
and say so), then record the brief with `/staff-engineer:brief`.
