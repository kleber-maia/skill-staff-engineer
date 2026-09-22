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
- **From npm:** `npx github:kleber-maia/skill-staff-engineer install` inside the project.

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
  node .staff-engineer/cli.mjs config set rules.testQuality.scope all
  node .staff-engineer/cli.mjs config set paths.documentable '["scripts/**","package.json","*.config.*"]'
  ```

  Gate names: `install`, `format`, `lint`, `typecheck`, `test`, `e2e`, `build`.
  Setting a gate to `null` means "this project has no such step"; be honest about it.
- Keep the upgrade-safe `rules.testQuality.scope` default (`changed`) unless the
  existing test tree is clean and the project wants whole-tree enforcement (`all`).
  Use `paths.documentable` for tooling, configuration, CI, and skill surfaces that
  require documentation without being product source.
- Rerun `doctor` until it reports ok.

## Explain what happened

Tell the operator, in plain language, what was installed and what changes for them:

- What was added: a set of working instructions for the agent (skills), a small
  settings file, and a short section in the project's agent instructions.
- What changes: the agent will ask a few questions before building, show a preview
  before finishing, and ask before saving anything. Nothing is saved without a
  "ship it". Small, obvious fixes get a single check-in instead of two. They never
  need to run anything themselves.

Do not list file paths or commands to a non-technical operator.

## Maintenance is not a concern

Installing, updating, configuring, and removing the toolkit never run the workflow the
toolkit adds. Do not call `begin`, `brief`, `preview`, `review`, `handoff`, or `ship` for
it, and do not apply its gates to its own files. After the doctor loop, ask the operator
and save with `node .staff-engineer/cli.mjs save-toolkit`; it commits only toolkit-owned
files and refuses while a concern is open.

## Upgrade

Every new concern starts with `begin`, which (at most once a day by default, local setting
`updates.checkEveryHours`) checks the recorded upstream repository before it opens a work
session. When upstream is newer, it upgrades only toolkit-owned files, preserves config
values, exceptions, and decisions, commits the upgrade as its own change, and opens the
session on the refreshed code. Only when toolkit files had unsaved edits does it stop and
ask for the upgrade to be saved separately. When upstream is unreachable, work continues
with the installed copy unless `updates.offline` is `fail`. Projects may also pin
`updates.revision` or change the per-process `updates.timeoutMs`. Updates
record the resolved commit and roll back toolkit-owned destinations if installation fails.

For a manual upgrade, run `node .staff-engineer/cli.mjs update --json` outside any open
concern; it saves the upgrade as its own change. It prefers the
recorded repository URL over the original local checkout, which may be stale. An
explicit `--from <path-or-url>` still overrides the recorded source. Run `doctor`
afterwards.

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
