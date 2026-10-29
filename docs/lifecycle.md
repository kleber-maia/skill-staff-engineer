# The lifecycle, step by step

The agent runs `node .staff-engineer/cli.mjs <command>`; the operator only talks.
`next` sequences the work, skills, and waiting points from the session under
`.git/staff-engineer/`. `status` and optional Claude hooks show the same state.

## Autonomy

**Final approval is the default for both new and existing installations.** Explicit
remembered choices override it. A session snapshots the chosen mode; preferences
are local to the checkout and survive chats and updates. An older session without
an autonomy record also follows Final approval.

| Mode | Flow |
| --- | --- |
| `guided` | Brief/interview → build → preview → operator acceptance → review/checks → handoff → operator approval → ship |
| `final-approval` | Brief/plan → build → preview → agent acceptance evidence → review/checks → handoff → one operator approval → ship |
| `autonomous` | Same agent verification → handoff summary → ship → configured deployment verification |

Every task starts with the prominent autonomy notice returned by `begin`. The agent
must display it to the operator, not leave it hidden in command output. “Walk me
through it”, “ask before shipping”, and “handle delivery” steer the current task;
“from now on” changes the default. “Hold” pauses further actions; it cannot undo a
completed action. No special phrase or user-run command is required. See the
[autonomy contract](../skills/staff-engineer/autonomy.md) for interpretation and evidence examples.

## Commands and guarantees

| Command | Guarantee |
| --- | --- |
| `next` | Reads state and returns the next step and whether to wait. Does not mutate it. |
| `begin "concern" --lane trivial\|standard\|large` | Checks for stable toolkit updates when due, saves a clean upgrade separately, snapshots existing dirty files, opens one concern, and prints its autonomy notice. Pending saves/deployments block new concerns. |
| `autonomy [mode\|hold\|resume] --instruction "words" [--remember]` | Records operator steering. The quote must match the latest harness-recorded message when available; otherwise it is agent-reported. Default changes require `--remember`; ordinary changes are task-only. A switch never converts prior acceptance into save approval. |
| `brief --outcome --accept ...` | Records the outcome and numbered acceptance criteria, non-goals, surfaces, and optional decisions/probes. Routine assumptions need no acknowledgment outside Guided mode. |
| `decisions [--for "words"]` | Finds earlier operator decisions relevant to this concern. |
| `lane <lane>` | Changes engineering scope independently of autonomy; leaving trivial drops its combined approval. |
| `plan <path>` | Records the written plan, required for large work. Guided mode asks for agreement; other modes derive it and ask only for material unknowns. |
| `context <files>` | Builds a packet of skills, related docs/tests, and imports. Blocking-session projects require current coverage. Trivial work needs no packet. |
| `preview` | Requires a nonempty, in-scope concern and any required plan/reproduction. Checks web reachability or command exit status, runs configured acceptance probes, and captures screenshots when available. Records the preview fingerprint. Guided mode waits for feedback; other modes proceed to inspection. |
| `acceptance <evidence.json>` | Outside Guided mode, requires one passed result with concrete evidence for each brief criterion and visual evidence. Web previews require inspected artifact references; nonvisual work may explain not-applicable. Failed, missing, duplicate, blocked, or stale evidence cannot finalize. Records agent verification, never operator approval. |
| `finalize --approval-quote "..."` | Guided mode only: validates operator preview acceptance after presentation and unlocks finishing. |
| `revise` | Returns to implementation and invalidates acceptance/handoff evidence so changed work can be previewed again. |
| `review` / `review done` | Prepares risk-sized review and binds the result to the exact reviewed code. Each finding has a disposition. A downgrade needs a reason. Later changes need delta review. |
| `repro "command"` | For `begin --bug`, requires failure on original code for the bug's reason and success on current code. Isolates original-code execution in a disposable worktree. Honest waivers are recorded. |
| `issues` / `issues resolve <id>` | Shows or resolves known issues; reported findings travel with the saved concern. |
| `exception add --rule --path --reason` | Records a justified permanent exception. Stale exceptions are blocked by lifecycle. |
| `lifecycle` | Checks staged rules, whole-concern staging, protected paths, source tests/docs or justified waivers, and (when configured) finalized-session/context coverage. |
| `verify --mode fast\|full` | Runs project checks. Full verification produces a receipt for exact inputs; commands that change inputs fail. Prose-only edits preserve test receipts, but still invalidate acceptance/handoff of the complete batch. |
| `handoff` | Requires current agent acceptance outside Guided mode. Binds the handoff to the receipt and complete batch, includes the deployment environment, and asks once in Final approval. Autonomous mode summarizes and continues. |
| `ship "message" [--approval-quote "..."]` | Requires finalization, lifecycle, current receipt/review, complete batch, and mode-specific authority. Autonomous mode records `Approval-Evidence: autonomy-policy`, never an invented operator quote. Creates one guarded commit and confirms intended Git delivery. |
| `ship --sync-only` | Resumes delivery of the same commit. Withdrawal or a switch out of autonomous delivery requires renewed authority; never force-push or create a duplicate commit. |
| `ship --recover` | Returns a changed/interrupted batch to review after the documented soft reset, retaining files. |
| `deploy [--retry --reason "..."]` | Uses destination/commands captured before saving. Requires the saved revision at HEAD, runs deployment and exact-revision/live smoke verification, and marks complete only on success. Recovery verifies first; redeployment needs an explicit retry reason. |
| `abort` | Closes an abandoned concern without deleting files. Cannot erase pending saves or deployments. |
| `status` | Shows session, receipt, autonomy notice, and next step. |
| `stats` | Shows local concern history and insights. |

A web preview responding or a screenshot existing is not proof that the interface
works. Agents must exercise affected flows and inspect actual visuals. Screenshot
capture is optional infrastructure; required inspection must use another available
browser capability or report a blocker. The CLI validates evidence structure and
freshness, not the truth of the agent's observations.

## Lanes and review

| Lane | Engineering requirements |
| --- | --- |
| `trivial` | Default cap: 3 source files, 40 added lines, no data/security impact. No interview/context packet; minimum review. Only Guided mode combines preview and save approval. |
| `standard` | Brief, context packet, working preview, standard review, lifecycle and full checks. |
| `large` | Standard plus a written plan and detailed review. |

Every code change has review: minimum is an author checklist; standard is one
fresh-context reviewer; detailed uses specialists and refutation. Data, sign-in,
secrets, and money raise the level to detailed; public interfaces/background work
to standard; large diffs raise it one level. `review.maxLevel` is a local cost cap.
Findings reported rather than fixed must be recorded as known issues.

## Efficiency and evidence

Guided `preview.selfCheck`: `off` skips probes, `auto` (the Guided default) probes
outside trivial work, `thorough` probes every lane and asks for changed-screenshot
inspection. Final approval and Through delivery always use thorough probes and
require acceptance evidence; a Guided efficiency preference cannot disable them.
Unchanged probes and full-check receipts are reused. Review uses deltas.

Agent acceptance binds the full batch, brief, and preview configuration. Changes
require refreshing the working preview and evidence. User approval binds the full
handoff batch, including prose and modes. Do not weaken checks to avoid reruns.

## Delivery and deployment

`ship` journals its expected tree and destination before committing. A commit hook
that changes the tree blocks delivery; follow soft-reset recovery and verify the
changed work. A remote save is complete only after the intended branch contains
the saved commit. `shipping.mode: local` intentionally disables remote delivery;
`remote`, `branch`, and `timeoutMs` configure it otherwise.

Optional `deployment` config contains `environment`, `cmd`, `verifyCmd`, and
`timeoutMs`. Both commands receive `STAFF_ENGINEER_COMMIT` and
`STAFF_ENGINEER_DEPLOY_ENVIRONMENT`. Verification must confirm that revision is
live and relevant smoke checks pass. For push-triggered deployments, the deploy
command should wait for that deployment instead of creating another.

After Git delivery, deployment-configured sessions stay `delivered` until `deploy`
verifies success, then become `synced`. The saved configuration is used on retries;
editing project configuration cannot silently change a previously authorized
operation. A failed verification keeps the task pending. Retry checks the existing
deployment before repeating any side effect. Toolkit maintenance remains separate
and uses `save-toolkit`; it does not deploy product changes.

## Approval and steering evidence

Guided/Final approval saves quote the operator verbatim after the relevant
presentation. Claude's UserPromptSubmit hook records recent messages; quotes must
match the latest eligible message, and negative/mixed replies cannot be mined for
approval. Other harnesses record agent-reported quotes. Autonomous saves record
mode authorization separately. Later withdrawals pause delivery; changing mode or
resuming requires recording the operator's new instruction.

Hooks detect conservative pause phrases and stop subsequent supported actions.
They do not infer broad consent from arbitrary language, and are not a sandbox.
Other harnesses follow the skill contract. A running external process may already
have acted before a pause is received.

## Optional release follow-up

On successful completion, `ship` (or `deploy` when deployment is configured) records
`releaseOffer` for the delivered commit and returns a one-time release-process question.
A failed push or unverified deployment never offers a release. The session remains
`synced`; ignoring or declining the offer does not block `begin` or cause reminders.
For a clear yes, the agent follows the project's playbook using the main skill's
[release guidance](../skills/staff-engineer/release.md). The CLI records the offer,
not user consent; the agent resolves the reply in conversation and honors any
separate publication approval requirements. It does not assume a release provider.

## Memory

`ship` commits settled decisions/non-goals and known issues with the concern.
`begin` and `context` surface relevant earlier choices. Settings, autonomy
preferences, evidence, screenshots, review packets, receipts, operator messages,
and concern history remain local under the Git state directory. Local history
supports limited insights and every-tenth-save milestones without extra requests.
