import { loadConfig } from "../lib/config.mjs";
import { ok, refused } from "../lib/output.mjs";
import { CLI, markFinalizing, requireBrief, requireOpenSession, writeSession } from "../lib/session.mjs";
import { estimateSentence, typicalDurations } from "../lib/timings.mjs";

export const description = "Record the operator's acceptance of the preview and unlock finishing work.";
export const usage = "STAFF_ENGINEER_PREVIEW_APPROVED=1 finalize";

export default async function run({ cwd, env = process.env }) {
  loadConfig(cwd);
  const session = requireOpenSession(cwd);
  requireBrief(session);
  if (env.STAFF_ENGINEER_PREVIEW_APPROVED !== "1") {
    throw refused("Finishing work needs the operator's clear acceptance of the preview first.", {
      agent: `Only after the operator clearly accepted the preview (for example "looks good"), run: STAFF_ENGINEER_PREVIEW_APPROVED=1 ${CLI} finalize. Praise for one part or a question is not acceptance.`,
    });
  }
  const updated = markFinalizing(session);
  writeSession(cwd, updated);
  return ok({
    operator: "Great, I will finish it up and check everything before asking you to approve saving it.",
    agent: [
      "Acceptance recorded. Now, in order:",
      "1. Write or update tests for the changed behavior.",
      "2. Apply the simplify skill (four lenses) to the concern's diff.",
      "3. Update the documentation that describes the changed behavior.",
      `4. Stage the entire concern and run ${CLI} lifecycle.`,
      `5. Run ${CLI} verify --mode full once against the staged batch.`,
      `6. Run ${CLI} handoff and ask for approval. Only after "ship it": STAFF_ENGINEER_CHANGE_APPROVED=1 ${CLI} ship "Imperative message"`,
      `If finishing work changes anything the operator can see, run ${CLI} revise and return to the preview loop.`,
      estimateSentence(typicalDurations(cwd), "full") ?? "",
    ].filter(Boolean).join("\n"),
    data: { phase: updated.phase, acceptedAt: updated.acceptedAt },
  });
}
