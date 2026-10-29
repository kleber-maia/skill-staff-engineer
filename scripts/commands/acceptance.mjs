import { resolve } from "node:path";
import { readJson } from "../lib/fs-safe.mjs";
import { acceptanceFingerprint, validateEvidence } from "../lib/acceptance.mjs";
import { isGuided } from "../lib/autonomy.mjs";
import { loadConfig } from "../lib/config.mjs";
import { ok, refused } from "../lib/output.mjs";
import { markFinalizing, PHASES, requireBrief, requireOpenSession, writeSession } from "../lib/session.mjs";

export const description = "Record evidence from exercising and visually inspecting the working result; unlock finishing without impersonating the operator.";
export const usage = "acceptance <evidence.json>";
export default async function run({ cwd, positional }) {
  const config = loadConfig(cwd);
  const session = requireOpenSession(cwd);
  requireBrief(session);
  if (isGuided(session)) throw refused("Guided mode needs the operator's preview acceptance. Use finalize with their words.");
  if (![PHASES.AWAITING_FEEDBACK, PHASES.FINALIZING].includes(session.phase)) throw refused("Run preview before recording acceptance evidence.");
  const fingerprint = acceptanceFingerprint(cwd, config, session);
  if (session.previewFingerprint !== fingerprint) throw refused("The result changed since preview. Run revise and preview again before inspecting it.");
  if (!positional[0]) throw refused(`Usage: ${usage}. Keep evidence under .git/staff-engineer so it does not change the batch.`);
  const evidence = validateEvidence(readJson(resolve(cwd, positional[0])), session.brief, config);
  const acceptanceEvidence = { ...evidence, fingerprint, at: new Date().toISOString(), evidence: "agent-verification" };
  const updated = session.phase === PHASES.AWAITING_FEEDBACK ? markFinalizing(session, { evidence: "agent-verification" }) : session;
  writeSession(cwd, { ...updated, acceptanceEvidence });
  return ok({ operator: "", agent: "Acceptance evidence recorded. Continue with next; this is verification, not operator approval.", data: acceptanceEvidence });
}
