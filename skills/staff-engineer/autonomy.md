# Autonomy and conversational steering

The default for new and existing installations is **Final approval**. Lanes size
engineering work; autonomy controls interaction. Never lower checks to avoid a pause.

| Mode | Agent behavior | Operator touchpoints |
| --- | --- | --- |
| `guided` | Brief/interview, build, preview acceptance, review and full checks, approval to save | Current guided workflow; trivial preview combines acceptance and save approval |
| `final-approval` | Derive brief/plan, build, exercise and visually inspect the result, review/fix, full checks | One final approval of the verified batch before shipping |
| `autonomous` | Same verification, then ship and finish configured deployment | Only missing material decisions, authority, or capabilities |

## Start every task visibly

Run `begin`, then relay its **Autonomy:** line prominently as the first task update
before inspecting or editing product code. Include the deployment environment when
configured. This is a notice, not a question. Do not bury it in tool output. Apply
an explicit mode instruction in the initial request immediately after begin and
show only the resulting mode to the operator. After mid-task steering, show the
new notice once. `autonomy` without arguments reports the effective mode.

## The operator only talks

Interpret the user's request in context, then run the command yourself:

`autonomy <mode> --instruction "<their exact words>" [--remember]`

- “Handle this and deploy it” / “ship when ready”: `autonomous` for this task,
  within the stated delivery destination.
- “Handle it” without explicit delivery permission: `final-approval`, with fewer check-ins.
- “Let me see it before you ship” / “ask before shipping”: `final-approval`.
- “Walk me through this one”: `guided`.
- “Hold” / “stop”: `autonomy hold --instruction "..."`; pause further actions.
- “Continue”: `autonomy resume --instruction "..."`; retain the selected mode.
- “From now on” / “remember this”: add `--remember`. Otherwise change only this
  task. A remembered preference applies to this project checkout, survives chats
  and updates, and is not committed or shared with other operators.

Never infer greater autonomy from praise, silence, elapsed time, or a generic
“looks good”. Never invent quotes. The CLI checks instructions against the latest
operator message when the harness records messages; other harnesses trust the
agent's report. A pause takes effect before the next action and cannot undo a
completed action or necessarily interrupt an already-running external command.

During installation, ask once: “Would you like check-ins along the way, a finished
result for approval (recommended), or for me to handle delivery too?” Record the
answer with `--remember`. Do not ask again at every task. An update defaults to
Final approval without a new onboarding question; an explicit saved choice wins.
When repeated requests or frustration suggest a different default, offer to
remember it at a natural moment. Do not silently make a temporary choice permanent.

## Work until the evidence is ready

For Final approval and Through delivery, infer routine decisions from the request,
repository, and recorded preferences. Write a brief and, in the large lane, a plan;
state assumptions without waiting for acknowledgment. Ask only when an unresolved
choice materially affects the outcome, scope, authorization, or irreversible work.
Keep agent assumptions distinct from operator-settled decisions.

Run `preview`, then exercise every acceptance criterion with available tools. For
UI changes, operate the affected flow and inspect actual screenshots or browser
captures at appropriate desktop/mobile sizes and relevant error/empty states.
Text in fetched HTML, a reachable URL, and merely capturing a screenshot do not
prove visual correctness. Prefer project/browser tools already available. Missing
browser access is a blocker to resolve or report, never a visual pass.

Write evidence under `.git/staff-engineer/` (resolve the Git state directory in a
worktree), then run `acceptance <path>`. Example:

```json
{
  "criteria": [
    { "criterion": 1, "status": "passed", "evidence": "Exported orders for June; the downloaded CSV contained the selected orders and excluded July." }
  ],
  "visual": {
    "status": "passed",
    "evidence": "Inspected Orders at desktop and mobile sizes, including empty results. No clipping; the export control remains usable.",
    "artifacts": ["<actual inspected screenshot path or browser artifact reference>"]
  }
}
```

Use one numbered result per brief criterion. Failed or blocked results cannot
finalize. For a CLI, API, or plain-text change with no visual surface, use visual
`not-applicable` with a concrete explanation. Do not waive visuals for a web preview.
The CLI records the agent's evidence, not proof of what it perceived. Never claim
more than actually inspected. Evidence covers the preview configuration, brief,
and complete batch; changes require a fresh preview and evidence. Review fixes
loop through `revise` and `preview`, with delta review and reusable test receipts.

`next` drives review, lifecycle, and full verification after acceptance. In Final
approval it requests one handoff approval; in autonomous mode the handoff is a
summary and `ship` continues without a fabricated approval quote. Keep reporting
meaningful progress; autonomy does not mean silence.

## Delivery scope

“Done” includes committing the verified batch and confirming its push when the
project has a remote. Treat commit and push as one recoverable operation. An
approval request means ready for approval, not complete; after approval, continue
through delivery without another check-in. A failed push remains pending and
retries the same commit. Report intentional local-only work explicitly as local.

Autonomy authorizes the requested work through the established destination. It
never authorizes new scope, destructive operations, or bypassing project rules.
Know whether pushing the selected branch itself deploys production. When the
request needs deployment, infer the destination and commands from project/CI
conventions, asking only if ambiguous; configure `deployment` before the final
verification and handoff. Do not downgrade “deploy” to “push” and call it done.

Optional project config `deployment` has `environment`, `cmd`, `verifyCmd`, and
`timeoutMs`. The commands receive `STAFF_ENGINEER_COMMIT` and
`STAFF_ENGINEER_DEPLOY_ENVIRONMENT`. `verifyCmd` must wait/check for that exact
revision and run relevant live smoke checks; a generic HTTP 200 is insufficient.
For push-triggered deployment, `cmd` should wait for the existing deployment,
not create another. The final approval names the environment and covers delivery.
Do not change destinations after approval; the saved operation retains its config.

After `ship`, follow `next` through `deploy`. If verification fails, investigate and
rerun `deploy` to check the same revision. It does not repeat a deployment unless
`--retry --reason "..."` explains why repetition is safe. Stop and explain genuine
external blockers. Never report deployment complete while its status is pending.
