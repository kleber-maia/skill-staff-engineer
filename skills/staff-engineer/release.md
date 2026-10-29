# Optional release follow-up

After a task's commit and delivery are confirmed, relay the release question from
`ship` with the completion message. If deployment is configured, `deploy` supplies
it only after live verification. Ask once per completed task in every autonomy
mode, including intentional local-only work (describe that delivery honestly).

> Run the release process? Say “yes” and I’ll follow this project’s release playbook, including publication if it calls for it.

The task is already complete. Silence, “no”, or a new request does not start release
work, trigger reminders, or block another task. Autonomy never answers this optional
question for the operator. Do not bump versions, tag, or publish just because a task
finished. `releaseOffer` in the completed session records the offered commit and
question; it is an audit record, not authorization.

## When the operator says yes

Interpret the reply in conversation: it must clearly answer the release question,
not an unrelated question or an earlier approval prompt. An ambiguous “yes” needs
clarification before release side effects. Once clear, do the work rather than
asking them to invoke a skill, choose CLI flags, or restate their request.

1. Read project instructions first (`AGENTS.md`, `CLAUDE.md`, README), then locate
   the release playbook: for example `RELEASING.md`, `docs/releases.md`, package
   release scripts, CI workflows, or established changelog/tag conventions. Follow
   the project's actual procedure; do not assume GitHub Releases, npm, or SemVer.
2. Identify the intended release scope, branch, current version, last published
   release, and delivered commit. If the branch advanced since the question,
   reconcile the playbook's target with the offered commit; never silently publish
   unrelated work. Never reuse or move a released tag.
3. Execute the playbook: prepare its required version changes and release notes,
   run checks, commit/push any preparation changes, then publish when the playbook
   calls for it and authorization covers the exact action. State the chosen version
   and reason in a short progress update. A yes authorizes the described release
   process, but never overrides an explicit project requirement for a separate
   approval of a particular tag, commit, or publication destination.
4. Verify the outcome at the publication destination, including expected revision
   and required assets. Report the version and usable release link. A failed or
   interrupted release stays pending: inspect it before retrying; do not recreate
   an existing release or announce success just because dispatch succeeded.

Release preparation may require its own tracked change under the project's rules.
Do not recursively ask to start another release when committing those preparation
changes: the operator already requested this release. A project-mandated approval
for the exact prepared version/commit still applies.

## Missing or incomplete playbook

Inspect existing scripts, workflows, tags, and publication metadata first. Infer
routine details only when unambiguous. If no procedure is established, propose a
concrete release procedure and resolve the missing destination or approval policy
before publishing. Never invent credentials, registries, version policy, or
production targets. Preserve useful preparation work while reporting blockers.
