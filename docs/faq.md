# FAQ

**The agent says tests are blocked. Why?**
The concern changed product source and the operator has not accepted a preview yet. Run
`preview`, wait for feedback, then `STAFF_ENGINEER_PREVIEW_APPROVED=1 ... finalize`.

**My project has no tests, linter, or build. Can I still use this?**
Yes. Set the gates to `null` (`config set gates.test null`). Verification then only records that
nothing applies, and `ship` still requires the lifecycle gate and approval.

**My project is a library or a CLI, not a website.**
Set `preview.kind` to `command` (a demo command whose output the operator can read) or `manual`
(explain how the operator sees the result).

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
enforces it. Only the slash commands, subagents, and hooks are Claude Code specific.

**How do I uninstall?**
`node <toolkit>/scripts/cli.mjs install --target . --uninstall`. Only toolkit-owned files and the
managed blocks are removed.
