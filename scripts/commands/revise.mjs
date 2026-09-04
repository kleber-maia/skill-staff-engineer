import { loadConfig } from "../lib/config.mjs";
import { ok } from "../lib/output.mjs";
import { CLI, markRevising, requireOpenSession, writeSession } from "../lib/session.mjs";

export const description = "Return the concern to implementation after operator feedback.";
export const usage = "revise";

export default async function run({ cwd }) {
  loadConfig(cwd);
  const session = requireOpenSession(cwd);
  const updated = markRevising(session);
  writeSession(cwd, updated);
  return ok({
    operator: "Working on your feedback.",
    agent: `Back in implementation. Update the same concern, then run ${CLI} preview again. Still no tests or final checks.`,
    data: { phase: updated.phase, round: updated.reviewRound },
  });
}
