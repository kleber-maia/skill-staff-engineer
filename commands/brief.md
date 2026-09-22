---
description: Record the plain-language brief for the open concern: outcome, acceptance checks, non-goals, surfaces.
---

Use the `grill-me` skill to settle the design first. Then run:

`node .staff-engineer/cli.mjs brief --outcome "..." --accept "..." [--accept "..."] [--non-goal "..."] [--surface "..."] [--decision "Topic: choice"] [--check "<n>: page <path> contains <text>"]`

Record every choice the operator settled with `--decision` so it is saved and reused. Add a `--check` probe (`page <path> contains <text>` or `run <command> contains <text>`) for acceptance checks the toolkit can verify itself before the preview.

Acceptance checks are things the operator can verify on the preview, each starting with a verb. Confirm the brief to the operator in one short message and start building the smallest working first pass. Run existing checks and add focused bug-reproduction or regression tests when useful; they do not replace preview acceptance. Arguments: $ARGUMENTS
