# The lifecycle, step by step

Every command below is `node .staff-engineer/cli.mjs <command>`. The state machine lives in
`.git/staff-engineer/session.json`.

| Step | Phase after | What the scripts guarantee |
|---|---|---|
| `begin "<concern>"` | `implementation` | One open session at a time. Files already dirty are fingerprinted; changing or staging them later is refused. |
| `brief --outcome --accept ...` | `implementation` | Outcome and at least one acceptance check exist before preview or finish. |
| `context <files>` | unchanged | Packet of skills, related docs and tests, and imported modules; digests recorded. The gate refuses when a listed skill changed afterwards and warns when source outside the packet changes. |
| `preview` | `awaiting_feedback` | Web previews must respond; command previews must exit 0. Acceptance checks are read back to the operator. |
| `revise` | `implementation` | Editing source while awaiting feedback is denied by the Claude hook until this runs. |
| `finalize` | `finalizing` | Needs `STAFF_ENGINEER_PREVIEW_APPROVED=1`, which the agent sets only after clear acceptance. Tests, simplify, docs, and verification are unlocked. |
| `lifecycle` | unchanged | Staged diff passes the language and structural rules; whole concern staged; no protected or never-stage paths; docs and tests present or waived. |
| `verify --mode full` | unchanged | All configured gates pass; a receipt fingerprints the code files. Docs edits keep it valid. Durations go to a ledger; runs slower than usual are flagged. |
| `handoff` | unchanged | Prefilled plain-language template from the brief and receipt. |
| `ship "<message>"` | `saved` then `synced` | Needs `STAFF_ENGINEER_CHANGE_APPROVED=1`, finalizing phase, passing gate, matching receipt, category limit. Trailers record the outcome and any waiver. |

## Why tests wait for feedback

The operator's feedback is part of implementation. Tests written before the operator has seen the
result tend to cement the wrong behavior and make change requests expensive. Concerns that touch no
product source (docs, tooling, test hygiene) may verify at any time: their checks are their preview.

## Why the receipt fingerprints only code

Finishing touches to documentation should not force another full run. Any code, test,
configuration, or dependency change after the full check invalidates the receipt.

## Approval vocabulary

| Operator says | Meaning | Agent action |
|---|---|---|
| "change X", a question, praise for one part | not acceptance | `revise`, keep working |
| "looks good", "that's right" | preview accepted | `STAFF_ENGINEER_PREVIEW_APPROVED=1 finalize` |
| "ship it" after the handoff | approval to save | `STAFF_ENGINEER_CHANGE_APPROVED=1 ship` |
| "hold" | keep reviewing | stay in finalizing |
