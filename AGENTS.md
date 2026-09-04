# staff-engineer: agent install contract

You are an AI coding agent reading this repository because someone asked you to **install
staff-engineer into their project**. This file tells you exactly what to do. It works for any
agent (Claude Code, Codex, Cursor, Gemini CLI, and others) and any tech stack.

## What this is

A toolkit that makes you work like a staff engineer for the person you are helping (the
**operator**, who may not be technical): interview before building, show a working preview before
writing tests, keep one concern per saved batch, run the project's own checks through a gate, and
ask for approval in plain language before saving. Skills describe the behavior; zero-dependency
Node scripts enforce it.

Requirements in the target project: **Node.js 20 or newer** and **git**. Nothing is installed from
npm.

## Install steps

1. Locate the toolkit. If you are reading this inside a clone, `<toolkit>` is this directory.
   Otherwise clone it: `git clone https://github.com/<owner>/skill-staff-engineer <toolkit>`.
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
7. Tell the operator, in plain language, what changed for them: before building you will ask a
   few questions, you will show a working result before finishing, and you will ask before saving.
   Suggest saving the installation as its own change.

## Upgrading, removing

- Upgrade: pull the toolkit and rerun step 4. Only toolkit-owned files change.
- Remove: `node <toolkit>/scripts/cli.mjs install --target . --uninstall`.

## Rules while installing

- Do not print secrets, environment files, or credentials.
- Do not modify files outside the target project.
- Do not skip the dry run or the doctor loop.
