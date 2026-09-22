// Staged-batch gate. Run before verification and again inside ship.
import { basename, extname } from "node:path";

import { loadConfig } from "../lib/config.mjs";
import { parseUnifiedDiff } from "../lib/diff.mjs";
import { loadExceptions, staleExceptions } from "../lib/exceptions.mjs";
import { readJson } from "../lib/fs-safe.mjs";
import { stagedDiff, stagedFiles, stagedNumstat, unstagedFiles } from "../lib/git.mjs";
import { failed, ok } from "../lib/output.mjs";
import { classify, isDocumentable, isNeverStage, isProductSource, isProtected } from "../lib/paths.mjs";
import { countGateBlocks } from "../lib/history.mjs";
import { laneOf, laneOverflow } from "../lib/lanes.mjs";
import { applyLineRules } from "../lib/rules.mjs";
import { PHASES, readSession, requireOpenSession, STATUSES, writeSession } from "../lib/session.mjs";
import { assetPath } from "../lib/toolkit.mjs";
import { checkBoundaries } from "../lib/boundaries.mjs";
import { checkTestQuality } from "../lib/test-quality.mjs";
import { applyUiRules } from "../lib/ui-rules.mjs";
import { validateWaiver } from "../lib/waivers.mjs";
import { readContext, staleSkills } from "./context.mjs";

export const description = "Check the staged batch for debug code, suppressions, unfinished work, oversized files, missing docs or tests, and unsafe paths.";
export const usage = "lifecycle [--json]";

export default async function run({ cwd, env = process.env }) {
  const config = loadConfig(cwd);
  const report = runLifecycle(cwd, config, env);
  if (report.blocking.length) {
    recordBlocks(cwd, report.blocking);
    throw failed(`The staged batch has ${report.blocking.length} issue${report.blocking.length === 1 ? "" : "s"} to fix before saving.`, {
      errors: report.blocking.map(formatFinding),
      agent: "Fix each finding, restage, and run lifecycle again. Do not bypass findings; use an exception with a reason only for a permanent, justified case.",
      data: report,
    });
  }
  return ok({
    operator: "The staged batch passes the lifecycle checks.",
    agent: report.warnings.length ? `Warnings (non-blocking):\n${report.warnings.map(formatFinding).join("\n")}` : "Run verify --mode full next if not done yet.",
    data: report,
  });
}

// Counted per concern so insights can spot rules that keep blocking.
export function recordBlocks(cwd, blocking) {
  const session = readSession(cwd);
  if (session && !session.cleared && session.status === STATUSES.OPEN) writeSession(cwd, countGateBlocks(session, blocking.map((finding) => finding.rule)));
}

export function runLifecycle(cwd, config, env = process.env) {
  const structural = readJson(assetPath("rules", "structural.json"));
  const exceptions = loadExceptions(cwd, config);
  const staged = stagedFiles(cwd);
  const findings = [];
  const session = readSession(cwd);
  const sessionSeverity = config.rules.requireSession === "block" ? "block" : "warn";

  if (!staged.length) {
    findings.push({ rule: "nothing-staged", severity: "block", file: "", line: 0, message: "Nothing is staged. Stage the whole concern before running the gate." });
    return summarize(findings);
  }

  // Path-level rules.
  for (const file of staged) {
    if (isProtected(config, file)) findings.push({ rule: "protected-path", severity: "block", file, line: 0, message: "Protected file staged. Unstage it; secrets and keys never enter history." });
    else if (isNeverStage(config, file)) findings.push({ rule: "never-stage", severity: "block", file, line: 0, message: "This kind of file must not be saved (logs, env files, reports, caches). Unstage it." });
    const kind = classify(config, file);
    const stem = basename(file, extname(file)).toLowerCase();
    if (kind === "source" && isNewFile(cwd, file) && structural.broadHelperNames.includes(stem)) {
      findings.push({ rule: "broad-helper", severity: "block", file, line: 0, message: "New broad helper files hide ownership. Put the behavior with the feature that owns it or in an existing, narrowly named module." });
    }
  }

  // Size rule.
  for (const { file, added } of stagedNumstat(cwd)) {
    const kind = classify(config, file);
    if (kind === "source" && added > config.rules.maxAddedLinesPerFile) {
      findings.push({ rule: "large-change", severity: "block", file, line: 0, message: `${added} lines added in one file (limit ${config.rules.maxAddedLinesPerFile}). Split it or simplify the design before saving.` });
    }
  }

  // Added-line rules per language, UI finish rules, and architecture boundaries.
  const diff = stagedDiff(cwd);
  const parsed = parseUnifiedDiff(diff, staged);
  findings.push(...applyLineRules(config, parsed, { exceptions }));
  findings.push(...applyUiRules(config, parsed, { exceptions }));
  findings.push(...checkTestQuality(cwd, config, parsed, { exceptions }));
  findings.push(...checkBoundaries(cwd, config, parsed, { exceptions }));

  // Session phase and partial staging relative to the session baseline.
  if (config.rules.requireSession !== "off") {
    let validated = null;
    try {
      validated = requireOpenSession(cwd);
    } catch (error) {
      findings.push({ rule: "session-required", severity: sessionSeverity, file: "", line: 0, message: error.message });
    }
    if (validated && validated.phase !== PHASES.FINALIZING) {
      findings.push({ rule: "session-phase", severity: sessionSeverity, file: "", line: 0, message: "Lifecycle waits until the working result was presented and accepted. Finalize the concern first." });
    }
    const overflow = validated ? laneOverflow(cwd, config, validated) : null;
    if (overflow) findings.push({ rule: "lane-exceeded", severity: "block", file: "", line: 0, message: overflow });
  }
  if (session && session.status === "open" && !session.cleared) {
    const baselineFiles = new Set(session.baseline?.files ?? []);
    const pending = unstagedFiles(cwd).filter((file) => !baselineFiles.has(file) && classify(config, file) !== "generated");
    if (pending.length) {
      findings.push({ rule: "partial-staging", severity: "block", file: pending.join(", "), line: 0, message: "The concern is only partly staged. Stage the entire verified concern together." });
    }
    const swept = staged.filter((file) => baselineFiles.has(file));
    if (swept.length) {
      findings.push({ rule: "baseline-swept", severity: "block", file: swept.join(", "), line: 0, message: "Files that were pending before this concern were staged. Keep them separate." });
    }
  }

  // Docs impact and test coverage.
  const kinds = staged.map((file) => classify(config, file));
  const touchesSource = staged.some((file) => isProductSource(config, file));
  const touchesDocumentable = staged.some((file) => isDocumentable(config, file));
  if ((touchesSource || touchesDocumentable) && config.rules.requireDocsImpact && !kinds.includes("docs")) {
    const waiver = validateWaiver(env.STAFF_ENGINEER_DOCS_WAIVER, "STAFF_ENGINEER_DOCS_WAIVER");
    if (!waiver.ok) findings.push({ rule: "docs-impact", severity: "block", file: "", line: 0, message: `Behavior changed without a documentation update in the same batch. Update the docs that describe it, or set STAFF_ENGINEER_DOCS_WAIVER="one-line reason". ${waiver.error ?? ""}`.trim() });
  }
  if (touchesSource && config.rules.requireTestPerSourceChange && !kinds.includes("tests")) {
    const waiver = validateWaiver(env.STAFF_ENGINEER_TEST_WAIVER, "STAFF_ENGINEER_TEST_WAIVER");
    if (!waiver.ok) findings.push({ rule: "test-coverage", severity: "block", file: "", line: 0, message: `Source changed without a changed or added test in the same batch. Add one, or set STAFF_ENGINEER_TEST_WAIVER="one-line reason". ${waiver.error ?? ""}`.trim() });
  }

  // Task-context packet: required sessions need a current packet that covers the
  // staged source and documentable surfaces. Advisory sessions keep warnings.
  const packet = readContext(cwd);
  // The trivial lane is size-capped instead, so it needs no packet.
  if (config.rules.requireSession !== "off" && session && !session.cleared && session.status === STATUSES.OPEN && laneOf(session) !== "trivial") {
    const packetIsCurrent = packet?.at && (!session.startedAt || packet.at >= session.startedAt);
    if (!packetIsCurrent) {
      findings.push({ rule: "context-required", severity: sessionSeverity, file: "", line: 0, message: "Build a current context packet for this concern before lifecycle." });
    } else {
      const known = new Set([...(packet.files ?? []), ...(packet.dependencies ?? [])]);
      const uncovered = staged.filter((file) => (isProductSource(config, file) || isDocumentable(config, file)) && !known.has(file));
      if (uncovered.length) {
        findings.push({ rule: "context-coverage", severity: sessionSeverity, file: uncovered.join(", "), line: 0, message: "The staged source or documentable scope grew beyond the context packet. Rerun context for the complete concern." });
      }
    }
  }
  if (packet) {
    for (const skill of staleSkills(cwd, packet)) {
      findings.push({ rule: "stale-skill", severity: "block", file: skill.path, line: 0, message: `The ${skill.name} skill changed after the context packet was built. Re-read it and rerun context.` });
    }
  }

  // Stale exceptions.
  for (const stale of staleExceptions(cwd, exceptions)) {
    findings.push({ rule: "stale-exception", severity: "block", file: stale.path, line: 0, message: `The exception for rule "${stale.rule}" matches no file anymore. Remove it from ${config.exceptionsFile}.` });
  }

  return summarize(findings);
}

function summarize(findings) {
  return {
    findings,
    blocking: findings.filter((finding) => finding.severity === "block"),
    warnings: findings.filter((finding) => finding.severity !== "block"),
  };
}

function isNewFile(cwd, file) {
  const staged = stagedFiles(cwd);
  return stagedNumstat(cwd).some((entry) => entry.file === file) && parseUnifiedDiff(stagedDiff(cwd), staged).some((entry) => entry.file === file && entry.status === "A");
}

export function formatFinding(finding) {
  const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}  ` : "";
  return `${location}[${finding.rule}] ${finding.message}${finding.text ? `  →  ${finding.text}` : ""}`;
}
