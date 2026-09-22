# Design notes

## Principles

1. **CLI checks; prose guides.** Stateful lifecycle, staged-batch, verification, and save rules
   have refusals in the CLI. Skills tell a cooperating agent how to work between those commands.
   Optional Claude Code hooks provide earlier feedback but fail open and are not a security boundary.
2. **One concern, one batch.** Mixed batches are how unrelated breakage ships. The session baseline
   makes sweeping in pre-existing work impossible without noticing.
3. **Regression tests during implementation, preview before completion.** See `docs/lifecycle.md`.
4. **Acceptance is not approval.** Two separate environment flags, set by the agent only after two
   separate, explicit operator statements.
5. **Stack-agnostic through configuration, not abstraction.** The toolkit never runs a linter or
   test runner of its own. It runs the project's commands and reads exit codes.
6. **Fail open in hooks, fail closed in commands.** A broken hook must never brick the agent; a
   broken gate must never let a batch through.
7. **Vendored, versioned, upgradeable.** The CLI is copied into the project so every harness and
   teammate runs the same gates. As the first action of `begin`, it checks the recorded upstream
   repository (not a potentially stale source checkout). `install` upgrades only toolkit-owned
   files. A changed upgrade or failed lookup opens no session; the upgrade stays a separate change
   and the concern restarts under the refreshed code.
8. **Separate behavior surfaces from product source.** `paths.documentable` makes scripts,
   configuration, CI, and skills require a documentation companion without also triggering the
   product-source test-pairing rule.
9. **Reproducible, bounded updates.** Projects may pin `updates.revision`, bound each subprocess
   with `updates.timeoutMs`, and explicitly choose whether an unavailable upstream blocks `begin`.
   Install and update rollback snapshots cover only toolkit-owned destinations and managed files.

## Trust boundary

The CLI enforces properties only when it is invoked. It validates state transitions, exact staged
scope, immutable verification inputs, matching receipts, and approval indicators before its own
commit operation. It cannot authenticate the human behind an environment variable or prevent a
repository owner, agent, or harness from running git or editing files outside the CLI. Claude Code
hooks improve feedback for one harness and intentionally fail open. `rules.requireSession` defaults
to `warn` for compatibility; projects that want lifecycle to refuse missing/finalization state use
`block`.

## Why Node

Every mainstream coding agent already requires Node. Zero dependencies means `node cli.mjs` works
the moment the repository is cloned, on macOS, Linux, and Windows.

## Why `.git/staff-engineer/` for state

It is never committed, needs no `.gitignore` entry, survives branch switches, and
`git rev-parse --git-path` makes it correct inside worktrees and submodules.

## Why copies instead of symlinks for skills

Symlinks need special handling on Windows and some agents resolve them inconsistently. Copies
stamped with `.staff-engineer-owned` are simple and upgrade cleanly.

## Optional capabilities

Preview screenshots use the project's own Playwright install when present and are skipped
otherwise. UI rules apply only to user-facing file types. Boundary rules apply only when the
project configures them, and only to newly added imports, so legacy debt never blocks a batch.
Test-quality scanning defaults to changed assertions for upgrade compatibility; projects with a
clean baseline can opt into `rules.testQuality.scope: "all"` for whole-tree enforcement.

## Non-goals (for now)

Deployment orchestration, skill evaluation suites, and multi-repository configuration are
planned for later versions and intentionally absent.
