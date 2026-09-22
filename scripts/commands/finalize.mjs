import { loadConfig } from "../lib/config.mjs";
import { checkApproval } from "../lib/approval.mjs";
import { laneOf } from "../lib/lanes.mjs";
import { nextStep, renderNext } from "../lib/next.mjs";
import { ok } from "../lib/output.mjs";
import { markFinalizing, PHASES, requireBrief, requireOpenSession, writeSession } from "../lib/session.mjs";
import { estimateSentence, typicalDurations } from "../lib/timings.mjs";

export const description = "Record the operator's acceptance of the preview and unlock finishing work.";
export const usage = 'finalize --approval-quote "<the operator\'s exact words>"';

export default async function run({ cwd, flags = {} }) {
  const config = loadConfig(cwd);
  const session = requireOpenSession(cwd);
  requireBrief(session);
  // Checked only while a preview waits, so an out-of-order call gets the phase refusal.
  const approval = session.phase === PHASES.AWAITING_FEEDBACK
    ? checkApproval(cwd, flags["approval-quote"], { since: session.presentedAt, purpose: "Finishing work" })
    : null;
  const updated = markFinalizing(session, approval);
  writeSession(cwd, updated);
  const combined = laneOf(updated) === "trivial" && Boolean(updated.presentedSource);
  return ok({
    operator: combined ? "Thanks. I will run the checks and save it." : "Great, I will finish it up and check everything before asking you to approve saving it.",
    agent: [
      `Acceptance recorded (${updated.acceptance.evidence}).`,
      renderNext(nextStep({ cwd, config, session: updated })),
      estimateSentence(typicalDurations(cwd), "full") ?? "",
    ].filter(Boolean).join("\n"),
    data: { phase: updated.phase, acceptedAt: updated.acceptedAt, acceptance: updated.acceptance, combinedApproval: combined },
  });
}
