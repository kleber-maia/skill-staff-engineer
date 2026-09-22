import { isNonTechnical, loadConfig } from "../lib/config.mjs";
import { openIssuesFor } from "../lib/issues.mjs";
import { ok } from "../lib/output.mjs";
import { readReceipt, receiptMatches } from "../lib/receipt.mjs";
import { recordHandoff, requireBrief, requireOpenSession, sessionConcernFiles, writeSession } from "../lib/session.mjs";

export const description = "Print a prefilled plain-language handoff for the operator.";
export const usage = "handoff";

export default async function run({ cwd }) {
  const config = loadConfig(cwd);
  const session = requireOpenSession(cwd);
  const brief = requireBrief(session);
  const receipt = readReceipt(cwd);
  const current = receipt ? receiptMatches(receipt, cwd, config, "working") : false;
  // Only a handoff of the verified batch can be answered with approval to save.
  if (current) writeSession(cwd, recordHandoff(session, receipt.at));
  const preview = config.preview?.kind === "web" ? (config.operator?.previewPublicUrl ?? config.preview.url) : null;
  const checked = describeChecks(receipt, current, config, session.review);
  const files = sessionConcernFiles(session, cwd);
  const weakSpots = openIssuesFor(cwd, files, { pending: (session.review?.issues ?? []).map((issue) => ({ ...issue, status: "open" })), resolved: session.resolvedIssues ?? [] });
  const text = renderHandoff({ brief, preview, checked, technical: !isNonTechnical(config), files, weakSpots: weakSpots.length });
  return ok({
    operator: text,
    agent: current
      ? "Fill the placeholders, send it, and stop. Only an explicit approval to save sent after this handoff counts; pass the operator's words to ship with --approval-quote."
      : "No current full verification receipt: run lifecycle and verify --mode full before sending this.",
    data: { brief, receiptCurrent: current, preview },
  });
}

export function renderHandoff({ brief, preview, checked, technical, files = [], weakSpots = 0 }) {
  const lines = [
    `What changed: ${brief.outcome}`,
    `What to look at: ${preview ? `${preview}, then ` : ""}${brief.surfaces.length ? brief.surfaces.join(", ") : "<where to see it>"}; check ${brief.acceptance.join("; ")}.`,
    `What was checked: ${checked}.`,
    `Left out on purpose: ${brief.nonGoals.length ? brief.nonGoals.join("; ") : "nothing"}.`,
    `Is this finished and approved to save? Reply "ship it" to save it, or "hold" to keep reviewing.`,
  ];
  if (weakSpots) lines.splice(4, 0, `Also noticed: ${weakSpots === 1 ? "one known weak spot" : `${weakSpots} known weak spots`} near this change, left as they were. I can fix ${weakSpots === 1 ? "it" : "them"} next if you like.`);
  if (technical && files.length) lines.splice(4, 0, `Files: ${files.join(", ")}`);
  return lines.join("\n");
}

const REVIEW_WORDS = { minimum: "a code self-review", standard: "an independent code review", detailed: "a detailed code review by several reviewers" };

function describeChecks(receipt, current, config, review) {
  if (!receipt || !current) return "<the checks have not been run on this exact version yet>";
  const ran = receipt.gates.filter((gate) => gate.status === "passed").map((gate) => gate.name);
  const words = { format: "formatting", lint: "code style", typecheck: "type safety", test: "automated tests", e2e: "end-to-end scenarios", build: "a full build" };
  const parts = ran.map((name) => words[name] ?? name);
  const manual = config.preview?.kind === "web" ? "the preview by hand" : "the result by hand";
  return [manual, ...(review ? [REVIEW_WORDS[review.level]] : []), ...parts].join(", ").replace(/, ([^,]*)$/, " and $1");
}
