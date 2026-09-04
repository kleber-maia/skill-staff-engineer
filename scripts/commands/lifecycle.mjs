// Staged-batch gate. Run before verification and again inside ship.
import { basename, extname } from "node:path";

import { loadConfig } from "../lib/config.mjs";
import { parseUnifiedDiff } from "../lib/diff.mjs";
import { loadExceptions, staleExceptions } from "../lib/exceptions.mjs";
import { readJson } from "../lib/fs-safe.mjs";
import { stagedDiff, stagedFiles, stagedNumstat, unstagedFiles } from "../lib/git.mjs";
import { failed, ok } from "../lib/output.mjs";
import { classify, isNeverStage, isProtected } from "../lib/paths.mjs";
import { applyLineRules } from "../lib/rules.mjs";
import { readSession } from "../lib/session.mjs";
import { assetPath } from "../lib/toolkit.mjs";
import { validateWaiver } from "../lib/waivers.mjs";

export const description = "Check the staged batch for debug code, suppressions, unfinished work, oversized files, missing docs or tests, and unsafe paths.";
export const usage = "lifecycle [--json]";

export default async function run({ cwd, env = process.env }) {
  const config = loadConfig(cwd);
  const report = runLifecycle(cwd, config, env);
  if (report.blocking.length) {
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

export function runLifecycle(cwd, config, env = process.env) {
  const structural = readJson(assetPath("rules", "structural.json"));
  const exceptions = loadExceptions(cwd, config);
  const staged = stagedFiles(cwd);
  const findings = [];

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

  // Added-line rules per language.
  findings.push(...applyLineRules(config, parseUnifiedDiff(stagedDiff(cwd)), { exceptions }));

  // Partial staging relative to the session baseline.
  const session = readSession(cwd);
  if (session && session.status === "open" && !session.cleared) {
    const baselineFiles = new Set(session.baseline?.files ?? []);
    const pending = unstagedFiles(cwd).filter((file) => !baselineFiles.has(file) && classify(config, file) !== "generated");
    if (pending.length) {
      findings.push({ rule: "partial-staging", severity: "block", file: pending.join(", "), line: 0, message: "The concern is only partly staged. Stage the entire verified concern together." });
    }
    const swept = staged.filter((file) => baselineFiles.has(file) && !(session.baseline.stagedFiles ?? []).includes(file));
    if (swept.length) {
      findings.push({ rule: "baseline-swept", severity: "block", file: swept.join(", "), line: 0, message: "Files that were pending before this concern were staged. Keep them separate." });
    }
  }

  // Docs impact and test coverage.
  const kinds = staged.map((file) => classify(config, file));
  const touchesSource = kinds.includes("source");
  if (touchesSource && config.rules.requireDocsImpact && !kinds.includes("docs")) {
    const waiver = validateWaiver(env.STAFF_ENGINEER_DOCS_WAIVER, "STAFF_ENGINEER_DOCS_WAIVER");
    if (!waiver.ok) findings.push({ rule: "docs-impact", severity: "block", file: "", line: 0, message: `Behavior changed without a documentation update in the same batch. Update the docs that describe it, or set STAFF_ENGINEER_DOCS_WAIVER="one-line reason". ${waiver.error ?? ""}`.trim() });
  }
  if (touchesSource && config.rules.requireTestPerSourceChange && !kinds.includes("tests")) {
    const waiver = validateWaiver(env.STAFF_ENGINEER_TEST_WAIVER, "STAFF_ENGINEER_TEST_WAIVER");
    if (!waiver.ok) findings.push({ rule: "test-coverage", severity: "block", file: "", line: 0, message: `Source changed without a changed or added test in the same batch. Add one, or set STAFF_ENGINEER_TEST_WAIVER="one-line reason". ${waiver.error ?? ""}`.trim() });
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
  return stagedNumstat(cwd).some((entry) => entry.file === file) && parseUnifiedDiff(stagedDiff(cwd)).some((entry) => entry.file === file && entry.status === "A");
}

export function formatFinding(finding) {
  const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}  ` : "";
  return `${location}[${finding.rule}] ${finding.message}${finding.text ? `  →  ${finding.text}` : ""}`;
}
