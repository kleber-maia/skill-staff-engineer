# FAQ

**Can the agent write and run tests before I review the preview?**
Yes. Existing checks, bug reproductions, and focused regression tests can run during implementation.
They do not replace your review: the concern still needs a working preview and clear acceptance
before final lifecycle, full verification, and saving.

**Do I ever need to run a command or type a special phrase?**
No. The agent runs every toolkit command. You answer in your own words; the agent quotes your reply
when it records acceptance or approval.

**How does the toolkit know I really approved?**
In Claude Code, a hook records your recent messages locally and the save is refused unless the
agent's quote matches something you said after the step was shown to you. Other agents cannot
record your messages, so their quote is trusted as reported. Every commit records the quote and
which of the two applied (`Approval-Evidence`).

**Small fixes feel slow. Is there a faster path?**
Yes: the `trivial` lane. The agent picks it for obvious, low-risk changes within
`rules.lanes.trivial` (default 3 source files and 40 added lines). You get one preview that asks
"ship it?", and the change is saved exactly as you saw it. Anything that grows past the cap moves
to the normal path automatically.

**How often does the toolkit check for updates, and what if it is offline?**
At most once a day, when a new concern begins (`settings set updates.checkEveryHours <hours>`; `0`
checks every time). A clean upgrade is saved as its own change and work continues on the refreshed
toolkit. When the update server is unreachable, work continues with the installed toolkit by
default (`updates.offline: allow`); set it to `fail` in config, or on one machine with
`settings set updates.offline fail`, to require a successful check. Use `updates.revision` to pin
a branch, tag, or commit and `updates.timeoutMs` to bound each subprocess.

**Does the agent checking its own work cost a lot of tokens?**
No, by default. Automatic checks run inside the toolkit, not the model, and skip reruns when
nothing changed. Ask the agent to turn them off (`preview.selfCheck: off`) or up to `thorough`
(it also looks at screenshots that changed). The setting stays on your machine.

**How do I know the workflow is paying off?**
You do not have to ask. Every tenth saved change, the agent tells you how many were right the first
time you looked. Behind the scenes it also learns from this project's history (for example, when
changes keep needing several rounds) and adjusts how it works. The history stays on your machine.

**Does every change get a code review? Isn't that expensive?**
Every code change is reviewed, but the depth follows the risk. Small fixes get a quick checklist by
the agent itself (almost free), normal work one independent reviewer, and large or risky work
(stored data, sign-in, money) several specialists. Fixes after a review are reviewed as a delta
only. Ask the agent to cap the level on your machine if you need to spend less.

**Will the agent keep asking me the same questions?**
No. Decisions you make are saved with each change in `.staff-engineer/decisions.json`, and the
agent sees the few that apply to a new request before it asks anything.

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
enforces the lifecycle operations invoked through it. The reviewer instructions ship inside the
`code-review` skill, so any agent with subagents can run independent reviews. Only the slash
commands, the plugin's agents, and the hooks are Claude Code specific; without the hooks, approvals
are recorded as reported by the agent rather than checked against your messages.

**How do I uninstall?**
`node <toolkit>/scripts/cli.mjs install --target . --uninstall`. Only toolkit-owned files and the
managed blocks are removed; the decisions log stays, because it is the project's own record.
