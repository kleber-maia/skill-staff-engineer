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
    agent: `Back in implementation. Update the same concern and its focused regression tests, then run ${CLI} preview again. Final lifecycle and full verification still wait for acceptance.`,
    data: { phase: updated.phase, round: updated.reviewRound },
  });
}
