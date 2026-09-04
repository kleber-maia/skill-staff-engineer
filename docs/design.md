# Design notes

## Principles

1. **Scripts enforce; prose explains.** Every rule that matters has a refusal in a script or a
   deny in a hook. Skills tell the agent why and what to do instead.
2. **One concern, one batch.** Mixed batches are how unrelated breakage ships. The session baseline
   makes sweeping in pre-existing work impossible without noticing.
3. **Preview before tests.** See `docs/lifecycle.md`.
4. **Acceptance is not approval.** Two separate environment flags, set by the agent only after two
   separate, explicit operator statements.
5. **Stack-agnostic through configuration, not abstraction.** The toolkit never runs a linter or
   test runner of its own. It runs the project's commands and reads exit codes.
6. **Fail open in hooks, fail closed in commands.** A broken hook must never brick the agent; a
   broken gate must never let a batch through.
7. **Vendored, versioned, upgradeable.** The CLI is copied into the project so every harness and
   teammate runs the same gates; `install` upgrades only toolkit-owned files.

## Why Node

Every mainstream coding agent already requires Node. Zero dependencies means `node cli.mjs` works
the moment the repository is cloned, on macOS, Linux, and Windows.

## Why `.git/staff-engineer/` for state

It is never committed, needs no `.gitignore` entry, survives branch switches, and
`git rev-parse --git-path` makes it correct inside worktrees and submodules.

## Why copies instead of symlinks for skills

Symlinks need special handling on Windows and some agents resolve them inconsistently. Copies
stamped with `.staff-engineer-owned` are simple and upgrade cleanly.

## Non-goals (for now)

Deployment orchestration, screenshots, timing ledgers, task-context packets, UI-quality lint, and
architecture-boundary checks are planned for later versions and intentionally absent from v0.1.
