# The lifecycle, step by step

Every command below is `node .staff-engineer/cli.mjs <command>`. The state machine lives in
`.git/staff-engineer/session.json`.

| Step | Phase after | What the scripts guarantee |
|---|---|---|
| `begin "<concern>"` | `implementation` | Before opening anything, checks the recorded upstream repository at the configured revision. A changed toolkit is installed transactionally as a separate change and the concern is refused until restart. Lookup failure follows `updates.offline`. When current, one session opens and already-dirty/index files are fingerprinted. |
| `brief --outcome --accept ...` | `implementation` | Outcome and at least one acceptance check exist before preview or finish. |
| `context <files>` | unchanged | Packet of skills, related docs and tests, and imported modules; digests recorded. With blocking sessions, lifecycle refuses a missing, pre-session, or incomplete packet. Listed-skill drift always blocks. |
| `preview` | `awaiting_feedback` | Refuses an empty concern. Source and focused regression tests may be presented together on every review round. Web previews must respond; command previews must exit 0. Acceptance checks are read back to the operator. |
| `revise` | `implementation` | Editing source while awaiting feedback is denied by the Claude hook until this runs. |
| `finalize` | `finalizing` | Needs `STAFF_ENGINEER_PREVIEW_APPROVED=1`, which the agent sets only after clear acceptance. Simplification, final documentation, lifecycle, and the final full verification are unlocked. |
| `lifecycle` | unchanged | Blocking-session projects must be finalizing with current context coverage. The staged diff passes language and structural rules; the whole concern is staged; no protected or never-stage paths; docs and tests are present or waived. |
| `verify --mode full` | unchanged | All configured gates pass without changing HEAD or their inputs; a receipt fingerprints executable, rule, dependency, and configuration files, including toolkit runtime/config. A new run invalidates an older receipt immediately. Prose-only docs and skill edits keep it valid. Durations go to a ledger; runs slower than usual are flagged. |
| `handoff` | unchanged | Prefilled plain-language template from the brief and receipt. |
| `ship "<message>"` | `saved` then `synced` | Needs `STAFF_ENGINEER_CHANGE_APPROVED=1`, finalizing phase, passing gate, matching receipt, category limit. Trailers record the outcome and any waiver. |

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
| "looks good", "that's right" | preview accepted | `STAFF_ENGINEER_PREVIEW_APPROVED=1 finalize` |
| "ship it" after the handoff | approval to save | `STAFF_ENGINEER_CHANGE_APPROVED=1 ship` |
| "hold" | keep reviewing | stay in finalizing |
