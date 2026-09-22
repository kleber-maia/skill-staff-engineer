// Code review sized to the change. The lane sets the base level, risk signals in
// the changed paths raise it, and a local setting can cap it. The CLI prepares one
// packet (diff or delta, brief, callers, tests) so reviewers never crawl the
// repository, and a review record binds the result to the exact code reviewed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { output, outputRaw } from "./exec.mjs";
import { ensureDir } from "./fs-safe.mjs";
import { isTracked, stateDir } from "./git.mjs";
import { matchesAny } from "./glob.mjs";
import { laneOf } from "./lanes.mjs";
import { classify, isProtected } from "./paths.mjs";
import { codeTreeFingerprint } from "./receipt.mjs";
import { sessionConcernFiles } from "./session.mjs";
import { openIssuesFor } from "./issues.mjs";
import { getSetting } from "./settings.mjs";

export const REVIEW_LEVELS = ["minimum", "standard", "detailed"];
export const DATA_PATTERNS = ["**/migrations/**", "**/*.sql", "**/schema*", "**/models/**", "**/seed*", "**/backup*", "**/*.db", "**/db/**", "**/database/**"];
const LANE_LEVEL = { trivial: "minimum", standard: "standard", large: "detailed" };
const SIGNALS = [
  { id: "data", level: "detailed", test: (file, config) => matchesAny(file, DATA_PATTERNS) || isProtected(config, file), why: "changes stored data or its shape" },
  { id: "auth", level: "detailed", test: (file) => /(^|[/_.-])(auth|login|logout|session|password|passwd|token|oauth|jwt|permission|roles?|acl|crypto|secret)s?([/_.-]|$)/i.test(file), why: "touches sign-in, permissions, or secrets" },
  { id: "payments", level: "detailed", test: (file) => /(^|[/_.-])(payments?|billing|checkout|invoices?|stripe|charges?|refunds?|subscriptions?|pricing|wallet)([/_.-]|$)/i.test(file), why: "touches money" },
  { id: "contract", level: "standard", test: (file) => /(^|\/)(api|routes?|endpoints?|graphql|openapi|proto)(\/|\.|$)|\.proto$|openapi\.|swagger\./i.test(file), why: "changes a public interface" },
  { id: "concurrency", level: "standard", test: (file) => /(^|[/_.-])(workers?|queues?|jobs?|cron|locks?|concurren\w*|scheduler|threads?)([/_.-]|$)/i.test(file), why: "runs concurrently or in the background" },
];
const LARGE_CHANGE_LINES = 400;
const MAX_CALLERS = 40;

export function rank(level) {
  return REVIEW_LEVELS.indexOf(level);
}

// The concern's files whose review matters: what the full check fingerprints (prose excluded).
export function reviewableFiles(cwd, config, session) {
  const concern = new Set(sessionConcernFiles(session, cwd));
  return codeTreeFingerprint(cwd, config, "working").files.filter((file) => concern.has(file));
}

// { level, reasons, capped, reviewable } or level null when nothing needs review.
export function requiredReview(cwd, config, session) {
  const reviewable = reviewableFiles(cwd, config, session);
  if (!reviewable.length) return { level: null, reasons: ["only documentation changed"], capped: false, reviewable };
  const lane = laneOf(session);
  let level = LANE_LEVEL[lane];
  const reasons = [`${lane} lane`];
  for (const signal of SIGNALS) {
    const hits = reviewable.filter((file) => signal.test(file, config));
    if (hits.length && rank(signal.level) > rank(level)) {
      level = signal.level;
      reasons.push(`${signal.why} (${hits.slice(0, 3).join(", ")})`);
    }
  }
  if (addedLines(cwd, session, reviewable) > LARGE_CHANGE_LINES && level !== "detailed") {
    level = REVIEW_LEVELS[rank(level) + 1];
    reasons.push(`more than ${LARGE_CHANGE_LINES} added lines`);
  }
  const cap = getSetting(cwd, "review.maxLevel");
  if (rank(level) > rank(cap)) return { level: cap, reasons: [...reasons, `capped at ${cap} by this machine's review.maxLevel setting`], capped: true, reviewable };
  return { level, reasons, capped: false, reviewable };
}

// A review record is current while the reviewed code is unchanged (prose edits allowed).
export function reviewIsCurrent(cwd, config, session, mode = "working") {
  const record = session.review;
  return Boolean(record && record.codeTree === codeTreeFingerprint(cwd, config, mode).digest);
}

// Stores the reviewed content in git's object database so a later review can diff only what changed.
export function snapshot(cwd, files) {
  return Object.fromEntries(files.map((file) => [file, existsSync(join(cwd, file)) ? output("git", ["hash-object", "-w", "--", file], { cwd }) : "deleted"]));
}

// Writes the review packet and returns { path, delta, files, callers }.
export function buildPacket(cwd, config, session, required, { now = new Date().toISOString() } = {}) {
  const files = required.reviewable;
  const previous = session.review?.snapshot;
  const delta = Boolean(previous);
  const diff = delta ? deltaDiff(cwd, files, previous) : fullDiff(cwd, session, files);
  const callers = findCallers(cwd, files, diff);
  const tests = sessionConcernFiles(session, cwd).filter((file) => classify(config, file) === "tests");
  const brief = session.brief ?? {};
  const lines = [
    `# Review packet: ${session.concern}`,
    "",
    `Level: ${required.level} (${required.reasons.join("; ")})`,
    delta ? "Scope: DELTA. Only the changes made after the last review are below; review those, not the whole concern again." : "Scope: the complete concern.",
    "",
    "## Brief",
    `Outcome: ${brief.outcome ?? "(none)"}`,
    ...(brief.acceptance ?? []).map((item, index) => `Acceptance ${index + 1}: ${item}`),
    ...(brief.nonGoals ?? []).map((item) => `Non-goal: ${item}`),
    ...(brief.decisions ?? []).map((item) => `Decision: ${item}`),
    ...(session.repro?.command ? [`Bug reproduction: ${session.repro.command} (fails on the original code)`] : []),
    "",
    "## Changed files",
    ...files.map((file) => `- ${file}`),
    "",
    "## Tests in this change",
    ...(tests.length ? tests.map((file) => `- ${file}`) : ["- (none)"]),
    "",
    "## Callers of changed symbols outside this change",
    ...(callers.length ? callers.map((caller) => `- ${caller}`) : ["- (none found)"]),
    "",
    "## Known issues in these files",
    ...(knownIssues(cwd, session, files)),
    "",
    "## Diff",
    "```diff",
    diff.trim() || "(no textual changes)",
    "```",
  ];
  const dir = ensureDir(join(stateDir(cwd), "review"));
  const path = join(dir, `packet-${now.replace(/[:.]/g, "-")}.md`);
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return { path, delta, files, callers: callers.length };
}

function knownIssues(cwd, session, files) {
  const issues = openIssuesFor(cwd, files, { resolved: session.resolvedIssues ?? [] }).filter((issue) => files.includes(issue.file));
  return issues.length ? issues.map((issue) => `- #${issue.id} ${issue.file}:${issue.line} ${issue.summary} (still present? fixed by this change?)`) : ["- (none)"];
}

function fullDiff(cwd, session, files) {
  const tracked = files.filter((file) => isTracked(file, cwd));
  const untracked = files.filter((file) => !isTracked(file, cwd));
  const parts = [];
  if (tracked.length) parts.push(outputRaw("git", ["diff", session.baseCommit ?? "HEAD", "--", ...tracked], { cwd, allowFailure: true }));
  for (const file of untracked) parts.push(outputRaw("git", ["diff", "--no-index", "--", "/dev/null", file], { cwd, allowFailure: true }));
  return parts.join("\n");
}

function deltaDiff(cwd, files, previous) {
  const current = snapshot(cwd, files);
  const parts = [];
  for (const file of [...new Set([...files, ...Object.keys(previous)])]) {
    const before = previous[file];
    const after = current[file] ?? "deleted";
    if (before === after) continue;
    if (!before || before === "deleted") parts.push(outputRaw("git", ["diff", "--no-index", "--", "/dev/null", file], { cwd, allowFailure: true }));
    else if (after === "deleted") parts.push(`--- ${file}\n+++ /dev/null\n(file deleted)\n`);
    else parts.push(`--- a/${file}\n+++ b/${file}\n${outputRaw("git", ["diff", before, after], { cwd, allowFailure: true }).split("\n").slice(4).join("\n")}`);
  }
  return parts.join("\n");
}

// Names declared on changed lines, and where the rest of the repository uses them.
export function changedSymbols(diff) {
  const names = new Set();
  const declaration = /(?:function\*?|def|func|fn|class|interface|type|struct|enum|trait|module|const|let|var)\s+([A-Za-z_$][\w$]{2,})|([A-Za-z_$][\w$]{2,})\s*[:=]\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/g;
  for (const line of diff.split("\n")) {
    if (!/^[+-](?![+-])/.test(line)) continue;
    for (const match of line.matchAll(declaration)) names.add(match[1] ?? match[2]);
  }
  return [...names];
}

function findCallers(cwd, files, diff) {
  const own = new Set(files);
  const found = [];
  for (const name of changedSymbols(diff)) {
    const hits = output("git", ["grep", "-n", "-w", "-I", "--", name], { cwd, allowFailure: true }).split("\n").filter(Boolean);
    for (const hit of hits) {
      const file = hit.slice(0, hit.indexOf(":"));
      if (own.has(file)) continue;
      found.push(`${name}: ${hit.length > 160 ? `${hit.slice(0, 157)}...` : hit}`);
      if (found.length >= MAX_CALLERS) return found;
    }
  }
  return found;
}

function addedLines(cwd, session, files) {
  const tracked = files.filter((file) => isTracked(file, cwd));
  let total = files.filter((file) => !tracked.includes(file) && existsSync(join(cwd, file))).reduce((sum, file) => sum + readFileSync(join(cwd, file), "utf8").split("\n").length, 0);
  if (tracked.length) {
    for (const line of output("git", ["diff", "--numstat", session.baseCommit ?? "HEAD", "--", ...tracked], { cwd, allowFailure: true }).split("\n")) {
      const added = Number.parseInt(line.split(/\s+/)[0], 10);
      if (Number.isFinite(added)) total += added;
    }
  }
  return total;
}
