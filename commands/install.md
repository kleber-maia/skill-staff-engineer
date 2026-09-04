---
description: Install or upgrade the staff-engineer toolkit in the current project (skills, config, guardrails).
---

Read the `install` skill first.

1. Run a dry run and review the plan:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" install --target . --dry-run --json`
2. If existing skills with the same names are reported, ask the operator before adding `--replace-existing-skills`.
3. Run it for real: `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" install --target . --yes --json`
4. Run `node .staff-engineer/cli.mjs doctor --json` and ask the operator the listed questions one at a time, in plain language. Record each answer with `node .staff-engineer/cli.mjs config set ...`. Repeat until doctor reports no questions.
5. Tell the operator in plain language what was set up and what changes for them: you will ask a few questions before building, show a working preview before finishing, and ask before saving.

Arguments: $ARGUMENTS (for example `--reconfigure`, `--with-claude-hooks`, `--uninstall`).
