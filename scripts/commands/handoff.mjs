import { isNonTechnical, loadConfig } from "../lib/config.mjs";
import { ok } from "../lib/output.mjs";
import { readReceipt, receiptMatches } from "../lib/receipt.mjs";
import { requireBrief, requireOpenSession, sessionConcernFiles } from "../lib/session.mjs";

export const description = "Print a prefilled plain-language handoff for the operator.";
export const usage = "handoff";

export default async function run({ cwd }) {
  const config = loadConfig(cwd);
  const session = requireOpenSession(cwd);
  const brief = requireBrief(session);
  const receipt = readReceipt(cwd);
  const current = receipt ? receiptMatches(receipt, cwd, config, "working") : false;
  const preview = config.preview?.kind === "web" ? (config.operator?.previewPublicUrl ?? config.preview.url) : null;
  const checked = describeChecks(receipt, current, config);
  const text = renderHandoff({ brief, preview, checked, technical: !isNonTechnical(config), files: sessionConcernFiles(session, cwd) });
  return ok({
    operator: text,
    agent: current ? "Fill the placeholders, send it, and wait. Only an explicit \"ship it\" authorizes the approved ship command." : "No current full verification receipt: run lifecycle and verify --mode full before sending this.",
    data: { brief, receiptCurrent: current, preview },
  });
}

export function renderHandoff({ brief, preview, checked, technical, files = [] }) {
  const lines = [
    `What changed: ${brief.outcome}`,
    `What to look at: ${preview ? `${preview}, then ` : ""}${brief.surfaces.length ? brief.surfaces.join(", ") : "<where to see it>"}; check ${brief.acceptance.join("; ")}.`,
    `What was checked: ${checked}.`,
    `Left out on purpose: ${brief.nonGoals.length ? brief.nonGoals.join("; ") : "nothing"}.`,
    `Is this finished and approved to save? Reply "ship it" to save it, or "hold" to keep reviewing.`,
  ];
  if (technical && files.length) lines.splice(4, 0, `Files: ${files.join(", ")}`);
  return lines.join("\n");
}

function describeChecks(receipt, current, config) {
  if (!receipt || !current) return "<the checks have not been run on this exact version yet>";
  const ran = receipt.gates.filter((gate) => gate.status === "passed").map((gate) => gate.name);
  const words = { format: "formatting", lint: "code style", typecheck: "type safety", test: "automated tests", e2e: "end-to-end scenarios", build: "a full build" };
  const parts = ran.map((name) => words[name] ?? name);
  const manual = config.preview?.kind === "web" ? "the preview by hand" : "the result by hand";
  return [manual, ...parts].join(", ").replace(/, ([^,]*)$/, " and $1");
}
