import { autonomyNotice, assertMode, instructionEvidence, isInterruption, modeOf, preference, preferencePath } from "../lib/autonomy.mjs";
import { loadConfig } from "../lib/config.mjs";
import { writeJson } from "../lib/fs-safe.mjs";
import { ok, refused } from "../lib/output.mjs";
import { readSession, writeSession } from "../lib/session.mjs";

export const description = "Record conversational autonomy steering for this task, or remember the preference when requested.";
export const usage = 'autonomy [guided|final-approval|autonomous|hold|resume] --instruction "<operator words>" [--remember]';
export default async function run({ cwd, positional, flags = {} }) {
  const config = loadConfig(cwd);
  const session = readSession(cwd);
  const active = session && !session.cleared && ["open", "saved", "delivered"].includes(session.status);
  const current = active ? session.autonomy ?? { mode: modeOf(session) } : preference(cwd);
  const action = positional[0];
  if (!action) return ok({ operator: autonomyNotice({ autonomy: current }, active && session.deployment ? session.deployment.config : config.deployment), agent: "", data: current });
  if (["hold", "resume"].includes(action) && !active) throw refused("There is no active task to pause or resume.");
  if (["hold", "resume"].includes(action) && flags.remember) throw refused("Pause and resume apply only to the current task.");
  const mode = ["hold", "resume"].includes(action) ? current.mode : assertMode(action);
  const evidence = instructionEvidence(cwd, flags.instruction);
  if (["resume", "autonomous"].includes(action) && isInterruption(evidence.quote)) throw refused("That instruction asks to pause or review, not proceed autonomously.");
  const autonomy = { mode, ...evidence, paused: action === "hold" };
  if (!active && !flags.remember) throw refused("Start the task first, or use --remember when the operator requested a lasting preference.");
  if (flags.remember) writeJson(preferencePath(cwd), autonomy);
  if (active) {
    // A mode change never launders an old preview acceptance into save approval.
    writeSession(cwd, { ...session, autonomy, autonomyHistory: [...(session.autonomyHistory ?? []), autonomy], handoff: undefined, presentedSource: undefined, ...(action === "guided" && !session.shipping ? { phase: "implementation", acceptance: undefined, acceptanceEvidence: undefined } : {}) });
  }
  return ok({ operator: autonomyNotice({ autonomy }, active && session.deployment ? session.deployment.config : config.deployment), agent: `${flags.remember ? "Preference remembered for this checkout." : "Current task only; the default is unchanged."} Relay the notice and follow next. Never infer a mode change from praise or silence.`, data: autonomy });
}
