// Known issues: review findings reported but not fixed, tied to files and committed
// with the change, so later concerns that touch those files see them instead of
// the findings vanishing after the handoff.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { TOOLKIT_DIR } from "./config.mjs";
import { readJson, writeJson } from "./fs-safe.mjs";
import { refused } from "./output.mjs";

export const ISSUES_FILE = `${TOOLKIT_DIR}/known-issues.json`;
const ISSUE = /^([^\s:]+):(\d+)\s+(.{8,})$/;

export function readIssues(cwd) {
  const path = resolve(cwd, ISSUES_FILE);
  return existsSync(path) ? readJson(path, null)?.issues ?? [] : [];
}

// "src/cart/total.mjs:12 Rounds before applying tax" -> { file, line, summary }.
export function parseIssue(text) {
  const match = ISSUE.exec(String(text ?? "").replace(/\s+/g, " ").trim());
  if (!match) {
    throw refused(`The issue "${text}" needs a location and a description.`, { agent: 'Use --issue "path/to/file:line what is wrong and why it matters".' });
  }
  return { file: match[1], line: Number(match[2]), summary: match[3] };
}

// Open issues in these files or their folders, most specific first.
export function openIssuesFor(cwd, files, { pending = [], resolved = [] } = {}) {
  const dirs = new Set(files.map((file) => dirname(file)));
  return [...readIssues(cwd), ...pending]
    .filter((issue) => issue.status === "open" && !resolved.includes(issue.id))
    .map((issue) => ({ issue, score: files.includes(issue.file) ? 2 : dirs.has(dirname(issue.file)) ? 1 : 0 }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.issue.id - b.issue.id)
    .map(({ issue }) => issue);
}

// Applies this concern's new issues and resolutions. Returns the path when anything changed.
export function applyIssues(cwd, session, { now = new Date().toISOString() } = {}) {
  const added = session.review?.issues ?? [];
  const resolved = session.resolvedIssues ?? [];
  if (!added.length && !resolved.length) return null;
  const existing = readIssues(cwd);
  let next = Math.max(0, ...existing.map((issue) => issue.id));
  const updated = existing.map((issue) => (resolved.includes(issue.id) && issue.status === "open" ? { ...issue, status: "resolved", resolvedAt: now, resolvedBy: session.concern } : issue));
  const created = added.map((issue) => ({ id: (next += 1), at: now, concern: session.concern, status: "open", ...issue }));
  writeJson(resolve(cwd, ISSUES_FILE), { version: 1, issues: [...updated, ...created] });
  return ISSUES_FILE;
}

export function renderIssues(issues, heading = "Known issues in these files (fix them if they are in scope; otherwise leave them):") {
  return issues.length ? [heading, ...issues.map((issue) => `- #${issue.id ?? "new"} ${issue.file}:${issue.line} ${issue.summary}`)].join("\n") : "";
}
