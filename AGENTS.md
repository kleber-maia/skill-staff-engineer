# staff-engineer: agent install contract

## Maintaining this repository

When working on the staff-engineer source repository itself, toolkit maintenance does not run
the product lifecycle below. Run the repository's own tests and lint instead.
For implementation tasks, completion includes a cohesive commit and confirmed push.
Do not report done with changes left uncommitted or only committed locally. Treat
commit and push as one recoverable delivery operation: if push fails, keep delivery
pending and retry the same commit without creating a duplicate or force-pushing.

After **every successful push to this repository**, ask the operator whether to publish a GitHub
release. Name the proposed version/tag and exact pushed commit when ready. Push approval never
authorizes release publication; wait for an explicit answer before creating a release, pushing
a release tag, or dispatching the Release workflow. This instruction applies to this source
repository, not to product repositories that install the toolkit.

Use [docs/releases.md](docs/releases.md) for version bumps, preflight checks, and the manual
release workflow. A release must use a new `v<major.minor.patch>` tag matching `package.json`,
`.claude-plugin/plugin.json`, and `CHANGELOG.md`. Never reuse or move a released tag.

You are an AI coding agent reading this repository because someone asked you to **install
staff-engineer into their project**. This file tells you exactly what to do. It works for any
agent (Claude Code, Codex, Kimi, Pi, OpenCode, Cursor, and others) and any tech stack.

## What this is

A toolkit that makes you work like a staff engineer for the person you are helping (the
**operator**, who may not be technical): derive the brief before building, add focused regression tests
as useful, verify the working result including visuals, keep one concern per saved batch,
and run the project's own checks through a gate. Final approval is the default; Guided
and Through delivery modes are selected conversationally. Skills describe the behavior; zero-dependency
Node scripts enforce the lifecycle, verification, and guarded-save operations they own.

Requirements in the target project: **Node.js 20 or newer** and **git**. Nothing is installed from
npm.

## Installing is maintenance, not a concern

Installing, updating, configuring, or removing the toolkit never goes through the workflow the
toolkit adds: do not run `begin`, `brief`, `preview`, `review`, `handoff`, or `ship` for it, and do
not apply its gates to its own files. Use only the commands below. The workflow applies from the
operator's first product request after installation.

## Install steps

1. Locate the toolkit. For normal installations, use the latest published stable GitHub
   release from `https://api.github.com/repos/kleber-maia/skill-staff-engineer/releases/latest`.
   Clone its `tag_name`: `git clone --branch <tag_name> --depth 1 https://github.com/kleber-maia/skill-staff-engineer <toolkit>`.
   If using an existing clone, check out the published tag first unless the operator explicitly
   requested a development installation. If no stable release is available, report that and
   stop; never silently install from the default branch.
   (Claude Code users can instead add it as a plugin; see the README.)
2. From the operator's project directory, run a dry run and read the plan:
   ```bash
   node <toolkit>/scripts/cli.mjs install --target . --dry-run --json
   ```
   If the project is not a git repository, ask the operator, then add `--init-git`.
3. If the plan reports **existing skills with the same names**, tell the operator that they will be
   replaced (old copies are backed up under `.staff-engineer/backups/`) and add
   `--replace-existing-skills` only after they agree.
4. Run the real install:
   ```bash
   node <toolkit>/scripts/cli.mjs install --target . --yes --json
   ```
   It writes: `.staff-engineer/` (the vendored CLI, rules, templates, `config.json`,
   `exceptions.json`), `.agents/skills/<skill>/` for every skill, a managed block in `AGENTS.md`,
   `CLAUDE.md` importing it if missing, and a managed block in `.gitignore`. It never edits your
   own text outside the `<!-- staff-engineer:start -->` / `end` markers.
5. Run the health check and resolve every open question:
   ```bash
   node .staff-engineer/cli.mjs doctor --json
   ```
   For each item under `questions`, ask the operator **one question at a time, in plain
   language** (the question text is provided). Or infer the answer from README, CI config, or
   scripts if it is unambiguous. Record answers with
   `node .staff-engineer/cli.mjs config set gates.<name>.cmd "<command>"`, or
   `config set gates.<name> null` when a check does not apply. Repeat `doctor` until it reports no
   questions.
6. Read `.agents/skills/staff-engineer/SKILL.md` and follow it from now on.
7. Explain that the default is **Final approval**: you build, test, and visually inspect
   the result yourself, then ask once before shipping. Ask whether they prefer check-ins
   along the way, the finished result for approval (recommended), or delivery handled too.
   Record their answer with `node .staff-engineer/cli.mjs autonomy <mode> --instruction
   "<their words>" --remember` (`guided`, `final-approval`, or `autonomous`). The operator
   only talks; you run every command. Every product task begins with a visible autonomy
   notice and they can say “hold”, “ask before shipping”, or “handle it” to steer.
   Explain that at most once a day `begin` saves a newer stable release as its own change.
   Ask whether to save the installation, then run `node .staff-engineer/cli.mjs save-toolkit`.
   It commits only toolkit-owned changes and confirms delivery when the project has a
   remote. If delivery fails, rerun `save-toolkit` to send the same commit.

## Upgrading, removing

- Upgrade: `node .staff-engineer/cli.mjs update` (or pull the toolkit and rerun step 4, then
  `save-toolkit`). Only toolkit-owned files change, and `update` saves them as its own change.
  New concerns also check for updates on their own at `begin`.
- Remove: `node <toolkit>/scripts/cli.mjs install --target . --uninstall`.

## Rules while installing

- Do not print secrets, environment files, or credentials.
- Do not modify files outside the target project.
- Do not skip the dry run or the doctor loop.
