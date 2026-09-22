# The lifecycle, step by step

Every command below is `node .staff-engineer/cli.mjs <command>`, run by the agent. The operator
never runs a command. The state machine lives in `.git/staff-engineer/session.json`, and
`next` reads it to print the one next step (command, skills to read, whether to wait for the
operator). `status`, `begin`, `finalize`, and the Claude Code hooks show the same step.

| Step | Phase after | What the scripts guarantee |
|---|---|---|
| `next` | unchanged | Prints the one next step for the current lane and phase. Changes nothing. |
| `begin "<concern>" --lane <lane>` | `implementation` | When a check is due (local `updates.checkEveryHours`, default 24), checks the recorded upstream repository at the configured revision first. A changed toolkit is installed transactionally and, when toolkit files were clean, saved as its own commit (`Toolkit-Upgrade` trailer); the refreshed CLI then opens the session. Unsaved toolkit edits stop begin instead. Lookup failure follows `updates.offline` (local setting, else config; default `allow`). One session opens, already-dirty/index files are fingerprinted, and relevant earlier decisions are listed. |
| `brief --outcome --accept ...` | `implementation` | Outcome and at least one acceptance check exist before preview or finish. Optional `--decision "Topic: choice"` and `--check "<n>: page\|run ... contains ..."` probes. |
| `lane <lane>` | unchanged | Moves the concern to another lane. Leaving `trivial` drops its combined approval. |
| `plan <path>` | unchanged | Records the agreed plan. The `large` lane refuses its first preview without one. |
| `context <files>` | unchanged | Packet of skills, related docs and tests, and imported modules; digests recorded. With blocking sessions, lifecycle refuses a missing, pre-session, or incomplete packet (not needed in the size-capped `trivial` lane). Listed-skill drift always blocks. |
| `preview` | `awaiting_feedback` | Refuses an empty concern, a `trivial` concern past its size cap, and a `large` concern without a plan. In `trivial`, asks the save question and fingerprints the presented source. Runs the brief's probes per `preview.selfCheck` and refuses on failure; an unchanged concern reuses the last passing result. Source and focused regression tests may be presented together on every review round. Web previews must respond; command previews must exit 0. Acceptance checks are read back to the operator. |
| `revise` | `implementation` | Editing source while awaiting feedback is denied by the Claude hook until this runs. |
| `finalize --approval-quote "..."` | `finalizing` | Needs the operator's words of acceptance, sent after the preview (checked against recorded operator messages when the harness records them). The code review, final documentation, lifecycle, and the final full verification are unlocked. |
| `review` / `review done` | unchanged | Prepares the review packet at the required level (trivial before its preview; otherwise after acceptance). `done` records found/fixed/reported counts bound to the reviewed code; a lower level needs `--reason`. |
| `lifecycle` | unchanged | Blocking-session projects must be finalizing with current context coverage. The staged diff passes language and structural rules; the whole concern is staged; no protected or never-stage paths; docs and tests are present or waived. |
| `verify --mode full` | unchanged | All configured gates pass without changing HEAD or their inputs; a receipt fingerprints executable, rule, dependency, and configuration files, including toolkit runtime/config. A new run invalidates an older receipt immediately. Prose-only docs and skill edits keep it valid. Durations go to a ledger; runs slower than usual are flagged. |
| `handoff` | unchanged | Prefilled plain-language template from the brief and receipt. With a current receipt, binds the approval request to that receipt. |
| `ship "<message>" --approval-quote "..."` | `saved` then `synced` | Needs finalizing phase, passing gate, matching receipt, category limit, and approval: the operator's words sent after a handoff of this exact receipt, or in `trivial` the preview acceptance while the source is byte-identical. Needs a review record for this exact code at the required level. Trailers record the outcome, the approval quote, its evidence, the review, and any waiver. Decisions and non-goals are appended to `.staff-engineer/decisions.json` in the same commit. |

## Lanes

| Lane | Operator touchpoints | Skips | Adds |
|---|---|---|---|
| `trivial` | One: the preview asks "ship it?" | Interview, context packet, independent review, handoff | Size cap (`rules.lanes.trivial`, default 3 source files and 40 added lines); tests, docs, and the minimum review finish before the preview |
| `standard` | Brief, preview, handoff | Nothing | Nothing |
| `large` | Brief, plan, preview, handoff | Nothing | An agreed spec and plan before the first preview |

Every lane keeps the brief, a working preview, the lifecycle gate, the full check, and operator
approval. Lifecycle blocks a `trivial` concern that outgrew its cap (`lane-exceeded`).

## Code review levels

| Level | Default for | Who reviews | Extra cost |
|---|---|---|---|
| `minimum` | trivial lane | the author, with a checklist: acceptance traced to code, edge cases, callers, tests, a quick cleanup pass | near zero |
| `standard` | standard lane | one fresh-context `reviewer` covering bugs, regressions, requirements, and the four cleanup lenses | about one read of the diff |
| `detailed` | large lane | parallel `reviewer` focuses (correctness, requirements, regressions, security when relevant) and the four `simplify-*` lenses, then `review-refuter` on every non-cleanup finding | about 4-6x |

Paths that touch stored data, sign-in or secrets, or money raise the level to `detailed`; public
interfaces and background work raise it to at least `standard`; more than 400 added lines raises it
one level. The local `review.maxLevel` setting caps it on one machine. The CLI writes one packet
(brief, acceptance checks, changed files, tests, callers of changed symbols, diff) so reviewers
never crawl the repository. After a review, the packet holds only the delta since the reviewed
snapshot. Documentation-only changes need no review.

## Self-check levels

`preview.selfCheck` is a local setting (`settings set preview.selfCheck <level>`), never committed.

| Level | trivial | standard, large |
|---|---|---|
| `off` | nothing | nothing |
| `auto` (default) | nothing | the brief's probes (run by the CLI, no model tokens) |
| `thorough` | probes, plus a look at changed screenshots | probes, plus a look at changed screenshots |

Probes rerun only when the concern's files changed since the last passing run. Screenshots are
hashed per round, so the agent is only asked to look at images that changed.

## Decisions log

`ship` appends the brief's `--decision` entries and non-goals to `.staff-engineer/decisions.json`,
committed with the change. A newer decision on the same topic supersedes the older one. `begin`
(by concern words) and `context` (by files, areas, and surfaces) show at most five active entries;
`decisions --for "..."` searches on demand. Uninstalling keeps the file.

## Insights

`ship` and `abort` add a one-line summary of the concern to `.git/staff-engineer/history.json`
(local, never committed): lane and lane moves, preview rounds, probes, gate blocks, waivers, the
code-review level and counts, and approval evidence. Nobody has to ask for results:

- `begin` shows the agent at most two findings, only after enough history (usually five saved
  concerns): many review rounds, no automatic checks on web previews, a waiver or gate rule that
  keeps firing, trivial concerns that keep outgrowing their lane, or a saved change that was later
  reverted (with its review level, so similar changes are reviewed more deeply). A finding is shown once and repeats only when it changes, at most every 14 days.
- `ship` adds a plain-language milestone for the operator every tenth saved change.
- `stats` prints the summary for the agent.

## How approvals are checked

The agent passes the operator's own words with `--approval-quote`. The CLI refuses questions and
requests to wait. In Claude Code, the `UserPromptSubmit` hook records the operator's recent
messages under `.git/staff-engineer/`, and the quote must appear in a message sent after the step
being approved; the hooks deny agent writes to that record. In other harnesses nothing records the
operator's messages, so the quote is trusted as reported. Either way the commit carries
`Operator-Approval` and `Approval-Evidence` (`operator-log` or `agent-reported`) trailers for audit.

## Why regression tests may run before feedback

Existing checks, a test that reproduces the reported bug, and focused regression coverage provide
fast engineering feedback during implementation. They do not replace the operator's review.
`preview` still requires a working result, `finalize` still requires clear acceptance, and a change
request returns the session to implementation for code/test updates and another preview. The final
staged batch still needs lifecycle and a fresh full-verification receipt.

## Why the receipt ignores only prose

Finishing touches to prose documentation, managed agent instructions, and skill prose
should not force another full run. Any executable code, test, rule, configuration,
dependency, toolkit runtime, or toolkit metadata change after the full check invalidates
the receipt.

## Approval vocabulary

| Operator says | Meaning | Agent action |
|---|---|---|
| "change X", a question, praise for one part | not acceptance | `revise`, keep working |
| "looks good", "that's right" | preview accepted | `finalize --approval-quote "looks good"` |
| "ship it" at a trivial preview | preview accepted and save approved | `finalize --approval-quote "ship it"`, then checks and `ship` |
| "ship it" after the handoff | approval to save | `ship "..." --approval-quote "ship it"` |
| "hold" | keep reviewing | stay in finalizing |
