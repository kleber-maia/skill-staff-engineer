// Conversational preferences stay local to this checkout. The CLI records the
// operator's instruction; the agent interprets its meaning, never invents consent.
import { join } from "node:path";
import { readOperatorLog, normalizeWords } from "./approval.mjs";
import { readJson } from "./fs-safe.mjs";
import { stateDir } from "./git.mjs";
import { refused } from "./output.mjs";

export const MODES = ["guided", "final-approval", "autonomous"];
export const DEFAULT_AUTONOMY = "final-approval";
export const preferencePath = (cwd) => join(stateDir(cwd), "autonomy.json");
export function preference(cwd) {
  const stored = readJson(preferencePath(cwd), null);
  if (stored) assertMode(stored.mode);
  return stored ?? { mode: DEFAULT_AUTONOMY, evidence: "toolkit-default" };
}
export const modeOf = (session) => session?.autonomy?.mode ?? DEFAULT_AUTONOMY;
export const isGuided = (session) => modeOf(session) === "guided";
export function assertMode(mode) {
  if (!MODES.includes(mode)) throw refused(`Autonomy must be ${MODES.join(", ")}.`);
  return mode;
}
export function autonomyNotice(session, deployment = null) {
  if (session?.autonomy?.paused) return '**Autonomy: Paused** · Say “continue” when ready.';
  const mode = modeOf(session);
  if (mode === "guided") return '**Autonomy: Guided** · Say “handle it” for fewer check-ins.';
  if (mode === "autonomous" && deployment) return `**Autonomy: Through delivery → ${deployment.environment}** · I’ll verify and deploy. Say “ask before shipping” or “hold” anytime.`;
  if (mode === "autonomous") return '**Autonomy: Through delivery** · I’ll verify and ship. Say “ask before shipping” or “hold” anytime.';
  return '**Autonomy: Final approval** · I’ll verify, then ask before shipping. Say “ship when ready” or “walk me through it” to switch.';
}
export function instructionEvidence(cwd, raw) {
  const quote = String(raw ?? "").trim();
  if (!quote || quote.length > 2000) throw refused("Quote the operator's instruction with --instruction (1–2000 characters). Never invent an instruction.");
  const log = readOperatorLog(cwd);
  const latest = log?.messages.at(-1);
  if (log && (!latest || latest.truncated || !latest.text.includes(quote))) throw refused("That instruction is not in the operator's latest recorded message.");
  return { quote, evidence: log ? "operator-log" : "agent-reported", at: new Date().toISOString(), messageId: latest?.id ?? null };
}
// Conservative interruption detection, not a natural-language mode selector.
export function isInterruption(text) {
  const raw = String(text ?? "").trim().toLowerCase().replace(/[‘’]/g, "'");
  return /^(please\s+)?(hold|stop|pause|wait|cancel|no|nope)([,.!?]|$|\s+(on|here|for|until|a moment|a second|this task|the task|working|work|everything|shipping|deployment)\b)/.test(raw)
    || /\b(not yet|don'?t (ship|deploy|push|save)|do not (ship|deploy|push|save)|ask before shipping|ask before deploying|i want to review)\b/.test(normalizeWords(text));
}
export function assertActive(cwd, session) {
  if (session?.autonomy?.paused) throw refused("Work is paused by the operator.", { agent: "Wait for their instruction, then record it with autonomy resume --instruction before continuing." });
  if (modeOf(session) !== "autonomous") return;
  const policy = session?.autonomy;
  const log = readOperatorLog(cwd);
  const index = log?.messages.findIndex((item) => item.id === policy?.messageId) ?? -1;
  const newer = index >= 0 ? log.messages.slice(index + 1) : (log?.messages ?? []).filter((item) => item.at >= (policy?.at ?? session?.startedAt ?? ""));
  const currentTask = newer.filter((item) => !session?.startedAt || item.at >= session.startedAt);
  if (currentTask.some((item) => item.truncated || isInterruption(item.text))) throw refused("The operator has new instructions that may pause delivery.", { agent: "Address their latest message and record the requested autonomy mode or resume instruction before continuing." });
}
