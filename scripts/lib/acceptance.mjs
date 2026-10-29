import { createHash } from "node:crypto";
import { batchFingerprint } from "./receipt.mjs";
import { sessionConcernFiles } from "./session.mjs";
import { refused } from "./output.mjs";

export function acceptanceFingerprint(cwd, config, session) {
  return createHash("sha256").update(JSON.stringify({
    batch: batchFingerprint(cwd, "working", sessionConcernFiles(session, cwd)).digest,
    brief: session.brief,
    preview: config.preview,
  })).digest("hex");
}
export function acceptanceIsCurrent(cwd, config, session) {
  return Boolean(session.acceptanceEvidence?.fingerprint === acceptanceFingerprint(cwd, config, session));
}
export function requireAcceptance(cwd, config, session) {
  if (!acceptanceIsCurrent(cwd, config, session)) throw refused("Agent acceptance evidence is missing or stale.", { agent: "Exercise the final result, inspect affected visuals, and record acceptance evidence for every criterion before continuing. Changed previews need revise and preview again." });
}
export function validateEvidence(evidence, brief, config) {
  if (!Array.isArray(evidence?.criteria) || evidence.criteria.length !== brief.acceptance.length) throw refused("Evidence must cover every acceptance criterion exactly once.");
  const seen = new Set();
  for (const item of evidence.criteria) {
    if (!Number.isInteger(item.criterion) || item.criterion < 1 || item.criterion > brief.acceptance.length || seen.has(item.criterion)) throw refused("Evidence criterion numbers must uniquely match the brief (starting at 1).");
    seen.add(item.criterion);
    if (item.status !== "passed" || typeof item.evidence !== "string" || item.evidence.trim().length < 12) throw refused("Every criterion needs passed status and concrete evidence describing the observed result. Failed or blocked checks cannot finalize.");
  }
  const visual = evidence.visual;
  if (!visual || !["passed", "not-applicable"].includes(visual.status) || typeof visual.evidence !== "string" || visual.evidence.trim().length < 12) throw refused("Record visual inspection with status passed or not-applicable and a concrete explanation.");
  if (config.preview?.kind === "web" && visual.status !== "passed") throw refused("Web previews need actual visual inspection; missing browser access is blocked, not not-applicable.");
  if (visual.status === "passed" && (!Array.isArray(visual.artifacts) || !visual.artifacts.length || visual.artifacts.some((item) => typeof item !== "string" || !item.trim()))) throw refused("Visual inspection needs screenshot or browser artifact references that the agent actually inspected.");
  return { criteria: evidence.criteria, visual };
}
