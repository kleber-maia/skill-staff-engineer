---
name: install
description: Install, configure, upgrade, or remove the staff-engineer toolkit in a project. Use when an operator asks to set up, update, or remove the toolkit, or when doctor reports the toolkit as missing or misconfigured.
license: MIT
metadata:
  version: "1.0.0"
---

# Install

Install the toolkit into a project, configure its gates with the operator's help,
and explain what changed in plain language. Never print secrets. Never modify files
outside the target project.

## Prerequisites

1. Confirm Node.js 20 or newer (`node --version`) and git are available. If either is
   missing, tell the operator what to install and stop.
2. Confirm the target is a git repository at its root. If it is not, ask the operator
   whether to initialize one before continuing.

## Install

Pick the path that matches how you have the toolkit:

- **From a clone of the toolkit:** run a dry run first, review the file list, then
  run for real.

  ```bash
  node <clone>/scripts/cli.mjs install --target <project> --dry-run
  node <clone>/scripts/cli.mjs install --target <project> --yes
  ```

- **From the Claude plugin:** run `/staff-engineer:install` inside the project.
- **From npm:** `npx github:<owner>/skill-staff-engineer install` inside the project.

The installer writes the skills, `.staff-engineer/` (CLI, config, templates), and a
short section in the project's agent instructions file. It does not touch anything
else.

## Configure with doctor

Run `node .staff-engineer/cli.mjs doctor --json` from the project root and work
through the items.

- For every `needs_operator` item, first try to infer the answer from the README,
  package manifests, task runners, or CI configuration. Record what you find.
- Only when you cannot infer it, ask the operator ONE plain-language question at a
  time. Examples:
  - "How do you normally start the app to look at it?" (preview command and URL)
  - "Is there a command you run to check the code before sharing it?" (lint, tests)
  - "Does this project get built into a package or a site before it runs?" (build)
- Record each answer:

  ```bash
  node .staff-engineer/cli.mjs config set gates.<name>.cmd "<command>"
  node .staff-engineer/cli.mjs config set gates.<name> null      # not applicable
  node .staff-engineer/cli.mjs config set preview.kind web       # web | command | manual
  node .staff-engineer/cli.mjs config set preview.url "<url>"
  node .staff-engineer/cli.mjs config set operator.mode non-technical
  ```

  Gate names: `install`, `format`, `lint`, `typecheck`, `test`, `e2e`, `build`.
  Setting a gate to `null` means "this project has no such step"; be honest about it.
- Rerun `doctor` until it reports ok.

## Explain what happened

Tell the operator, in plain language, what was installed and what changes for them:

- What was added: a set of working instructions for the agent (skills), a small
  settings file, and a short section in the project's agent instructions.
- What changes: the agent will ask a few questions before building, show a preview
  before finishing, and ask before saving anything. Nothing is saved without a
  "ship it".

Do not list file paths or commands to a non-technical operator.

## Upgrade

Rerun the install command for your path. Only toolkit-owned files change; config
values and the exceptions file are preserved. Run `doctor` afterwards.

## Existing skills with the same names

If the installer reports existing skills named like the toolkit's (for example a
project already has `simplify` or `solid`), stop and ask the operator whether to
replace them. Only after confirmation rerun with `--replace-existing-skills`.
Otherwise leave them and report which skills were skipped.

## Uninstall

```bash
node .staff-engineer/cli.mjs install --uninstall
```

Removes toolkit-owned files and the instructions section. It does not remove the
project's own files, config the operator added elsewhere, or git history. Confirm
with the operator before running it.
