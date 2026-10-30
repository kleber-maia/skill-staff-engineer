---
description: Run the project's configured checks through the staff-engineer wrapper (fast or full).
---

`node .staff-engineer/cli.mjs verify --mode ${ARGUMENTS:-fast} --json`

- Both modes automatically select documentation checks only when the entire staged, unstaged and untracked diff is conventional, regular, non-executable prose: root README/changelog/FAQ files, or prose under docs, doc or documentation. Checks cover whitespace, final newlines, local Markdown link targets and source-line ranges; deleted documents are checked for incoming links. Code examples are never executed and external URLs are not fetched.
- Documentation receipts cover the exact checked text. Edit it again and rerun verification. A documentation receipt cannot authorize source code, executable/symlink/binary files, agent instructions, security/operational guidance, workflow/configuration changes or ambiguous mixed diffs. Approval rules remain unchanged.
- For code or mixed changes, fast runs format, lint, typecheck and tests (affected when configured). It may run during implementation for early feedback.
- For code or mixed changes, full adds build and end-to-end; it writes the receipt the guarded save requires. Run it once on the final staged batch; rerun after executable code, tests, rules, configuration, dependencies, toolkit runtime or workflow guidance changes. Ordinary prose can preserve a matching full code receipt.
- `{files}` in an affected-test command must be one top-level token outside quotes, with a simple static runner command. Shell command-evaluation templates such as `sh -c`, `eval`, and Windows `call` are unsupported. The wrapper passes paths as shell-safe environment values.
- On failure, read the focused report and fix the cause. Never add retries, weaken a check, or call a test flaky. Never rerun "to be safe".
