---
name: data-safety
description: Rules for handling secrets, live data, destructive actions, cleanup scripts, and backups. Use whenever a task touches environment files, credentials, databases, uploads, backups, or anything that deletes, resets, or bulk-changes data.
license: MIT
metadata:
  version: "1.0.0"
---

# Data Safety

Data loss and leaked secrets are the two mistakes an operator cannot undo with
"revise". Treat every step that reads or writes real data or credentials as
guarded, even when the operator is in a hurry.

## Secrets and environment files

- Never stage or commit env files, key files, certificates, tokens, or anything the
  project lists under `paths.protected` or `paths.neverStage`. The `lifecycle` and
  `ship` gates block them; do not work around the gate by renaming or copying.
- Never print a secret: not in chat, logs, shell history, test output, error
  messages, screenshots, or reports. When you must confirm a value exists, say
  "set" or "missing", never the value.
- Never paste a credential into a command line where it lands in shell history.
  Read it from the environment or a file the project already ignores.
- When a secret may have leaked (logged, committed, pasted), say so immediately in
  plain words and recommend rotation. Do not quietly delete the evidence.

## Live data versus development data

- Know which you are touching before you act. Live (production) data is what the
  operator's business runs on. Development or test data is disposable. If you cannot
  tell, stop and ask.
- Never run mutating tests, seed scripts, migrations, or cleanup against live data.
  Tests use disposable fixtures they create and remove themselves.
- Never copy live data into development without the operator's explicit approval
  and without removing personal or secret fields.
- Never use production credentials from a development environment.

## Writes to live data

Before any write to live data, describe the change in plain language and get
explicit approval after the description. Approval given before the description, or
for a different change, does not count. Writes include:

create, update, move, archive, delete, bulk change, reset, restore, invite, revoke.

Describe: what records, how many, what changes, whether it is reversible, and how
the operator can check the result. Then wait. Perform exactly the approved write
and report the outcome.

## Destructive actions

- Every delete, reset, truncate, bulk update, or history rewrite needs a dry run
  first: show exactly what would be affected and how many items, then get explicit
  confirmation of that list, then run it.
- Prefer reversible steps (archive, soft delete, rename) over irreversible ones.
- Never chain a destructive step after a failing step. Stop on the first failure.
- The toolkit's own `abort --discard-confirmed` discards uncommitted work; use it
  only after the operator confirmed the discard in plain words.

## Cleanup scripts

Any script or command that removes files must:

- be pinned to known generated directories (the `paths.generated` list in config or
  an explicit allowlist), never to a pattern that could match source, docs, or data;
- resolve the target path and reject it if it or any parent is a symbolic link;
- verify it is running at the expected project root (for example by checking for
  the repository marker and the toolkit config) before deleting anything;
- print what it will remove and require a flag to actually remove it.

## Backups and restore

- Before a restore, verify the backup: it exists, it is recent enough, it is
  readable, and it contains what the operator expects. Say what you verified.
- Never restore over live data without a dry run and explicit approval, and without
  a fresh backup of the current state first.
- Treat backup files as secrets: never stage, print, or move them outside the
  locations the project already uses.

## Reporting

When a task involved any of the above, the handoff says so in plain words: what
data was touched, what was verified, and what was deliberately left alone. Never
include credentials, connection strings, or personal data in the report.
