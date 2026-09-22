# FAQ

**Can the agent write and run tests before I review the preview?**
Yes. Existing checks, bug reproductions, and focused regression tests can run during implementation.
They do not replace your review: the concern still needs a working preview and clear acceptance
before final lifecycle, full verification, and saving.

**What happens when the update server is unavailable?**
The default `updates.offline` value is `fail`, so `begin` opens no session. Set it to `allow` only
when the project deliberately permits work with the installed toolkit. Use `updates.revision` to
pin a branch, tag, or commit and `updates.timeoutMs` to bound each subprocess.

**My project has no tests, linter, or build. Can I still use this?**
Yes. Set the gates to `null` (`config set gates.test null`). Verification then only records that
nothing applies, and `ship` still requires the lifecycle gate and approval.

**My project is a library or a CLI, not a website.**
Set `preview.kind` to `command` (a demo command whose output the operator can read) or `manual`
(explain how the operator sees the result).

**Can test-quality rules cover inherited tests, not only this diff?**
Yes. Set `rules.testQuality.scope` to `all`. The compatibility default is `changed`, so installing
the toolkit does not make a legacy repository fail on untouched debt.

**How do tooling or configuration changes require docs without counting as product source?**
Add their globs to `paths.documentable`. The defaults include common script, package, CI, and
configuration paths; projects can add their skill directories when those need a separate owner.
Documentable paths trigger docs impact and context coverage, but not source-test pairing.

**My operator preview address depends on the current machine. Should I save it in config?**
No. `operator.previewPublicUrl` is for a stable portable address. A machine-derived or
authenticated preview is project behavior: keep the toolkit's `preview.url` as the internal health
address and let the project preview integration compute and present the operator address at runtime.

**Can technical users skip the plain-language rules?**
Set `operator.mode` to `technical`. Messages may include commands and diffs. Every gate still
applies, and saving still needs an explicit "ship it".

**How do I allow `console.log` in a CLI entrypoint?**
Add the path to `paths.allowDebug`, or record a justified exception:
`exception add --rule debug-console --path "src/cli/**" --reason "The CLI prints its results to stdout"`.

**The gate says the batch spans too many areas.**
Split it into separate concerns. If the operator explicitly wants one cohesive change, set
`STAFF_ENGINEER_BROAD_CHANGE_REASON` (40-500 characters, at least 8 words); it is recorded in
the commit as `Broad-Change-Reason`.

**Does this work without Claude Code?**
Yes. The skills in `.agents/skills/` and the block in `AGENTS.md` carry the contract; the CLI
enforces the lifecycle operations invoked through it. Only the slash commands, subagents, and hooks
are Claude Code specific.

**How do I uninstall?**
`node <toolkit>/scripts/cli.mjs install --target . --uninstall`. Only toolkit-owned files and the
managed blocks are removed.
