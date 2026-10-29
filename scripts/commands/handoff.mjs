import { isGuided, modeOf } from "../lib/autonomy.mjs";
import { requireAcceptance } from "../lib/acceptance.mjs";
import { isNonTechnical, loadConfig } from "../lib/config.mjs";
import { openIssuesFor } from "../lib/issues.mjs";
import { ok } from "../lib/output.mjs";
import { batchFingerprint, readReceipt, receiptMatches } from "../lib/receipt.mjs";
import { recordHandoff, requireBrief, requireOpenSession, sessionConcernFiles, writeSession } from "../lib/session.mjs";

export const description = "Print a prefilled plain-language handoff for the operator.";
export const usage = "handoff";

export default async function run({ cwd }) {
  const config = loadConfig(cwd);
  const session = requireOpenSession(cwd);
  const brief = requireBrief(session);
  if (!isGuided(session)) requireAcceptance(cwd, config, session);
  const receipt = readReceipt(cwd);
  const current = receipt ? receiptMatches(receipt, cwd, config, "working") : false;
  // Only a handoff of the verified batch can be answered with approval to save.
  if (current) {
    const updated = recordHandoff(session, receipt.at);
    updated.handoff.batch = batchFingerprint(cwd, "working", sessionConcernFiles(session, cwd)).digest;
    writeSession(cwd, updated);
  }
  const preview = config.preview?.kind === "web" ? (config.operator?.previewPublicUrl ?? config.preview.url) : null;
  const checked = describeChecks(receipt, current, config, session.review, session.acceptanceEvidence);
  const files = sessionConcernFiles(session, cwd);
  const weakSpots = openIssuesFor(cwd, files, { pending: (session.review?.issues ?? []).map((issue) => ({ ...issue, status: "open" })), resolved: session.resolvedIssues ?? [] });
  const text = renderHandoff({ deployment: config.deployment, autonomous: modeOf(session) === "autonomous", brief, preview, checked, technical: !isNonTechnical(config), files, weakSpots: weakSpots.length });
  return ok({
    operator: text,
    agent: current
      ? modeOf(session) === "autonomous" ? "Summarize the verified result and continue to ship; the selected mode authorizes delivery." : "Fill the placeholders, send it, and stop. Only an explicit approval to save sent after this handoff counts; pass the operator's words to ship with --approval-quote."
      : "No current full verification receipt: run lifecycle and verify --mode full before sending this.",
    data: { brief, receiptCurrent: current, preview },
  });
}

export function renderHandoff({ deployment = null, autonomous = false, brief, preview, checked, technical, files = [], weakSpots = 0 }) {
  const lines = [
    `What changed: ${brief.outcome}`,
    `What to look at: ${preview ? `${preview}, then ` : ""}${brief.surfaces.length ? brief.surfaces.join(", ") : "<where to see it>"}; check ${brief.acceptance.join("; ")}.`,
    `What was checked: ${checked}.`,
    `Left out on purpose: ${brief.nonGoals.length ? brief.nonGoals.join("; ") : "nothing"}.`,
    autonomous ? `Verification is complete. I will save and deliver this result${deployment ? ` to ${deployment.environment}` : ""}.` : deployment ? `Is this finished and approved to save and deploy to ${deployment.environment}?` : `Is this finished and approved to save? Reply "ship it" to save it, or "hold" to keep reviewing.`,
  ];
  if (weakSpots) lines.splice(4, 0, `Also noticed: ${weakSpots === 1 ? "one known weak spot" : `${weakSpots} known weak spots`} near this change, left as they were. I can fix ${weakSpots === 1 ? "it" : "them"} next if you like.`);
  if (technical && files.length) lines.splice(4, 0, `Files: ${files.join(", ")}`);
  return lines.join("\n");
}

const REVIEW_WORDS = { minimum: "a code self-review", standard: "an independent code review", detailed: "a detailed code review by several reviewers" };

function describeChecks(receipt, current, config, review, acceptanceEvidence) {
  if (!receipt || !current) return "<the checks have not been run on this exact version yet>";
  const ran = receipt.gates.filter((gate) => gate.status === "passed").map((gate) => gate.name);
  const words = { format: "formatting", lint: "code style", typecheck: "type safety", test: "automated tests", e2e: "end-to-end scenarios", build: "a full build" };
  const parts = ran.map((name) => words[name] ?? name);
  const manual = acceptanceEvidence ? "the acceptance criteria exercised by the agent" + (acceptanceEvidence.visual.status === "passed" ? " and the visuals inspected" : "") : "the operator’s preview acceptance";
  return [manual, ...(review ? [REVIEW_WORDS[review.level]] : []), ...parts].join(", ").replace(/, ([^,]*)$/, " and $1");
}
