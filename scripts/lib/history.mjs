// Local history of finished concerns, one summary each, for insights. It stays in
// the git state directory: private to this machine and never committed.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readJson, writeJson } from "./fs-safe.mjs";
import { stateDir } from "./git.mjs";

const KEEP = 200;

export function historyPath(cwd) {
  return join(stateDir(cwd), "history.json");
}

export function readHistory(cwd) {
  const path = historyPath(cwd);
  return existsSync(path) ? readJson(path, null)?.concerns ?? [] : [];
}

export function recordConcern(cwd, session, { outcome, commit = null, trailers = {}, now = new Date().toISOString() }) {
  const entry = {
    concern: session.concern,
    outcome,
    lane: session.lane ?? "standard",
    kind: session.kind ?? "change",
    initialLane: session.initialLane ?? session.lane ?? "standard",
    startedAt: session.startedAt,
    endedAt: now,
    reviewRounds: session.reviewRound ?? 0,
    probes: session.brief?.checks?.length ?? 0,
    probeFailures: session.probeFailures ?? 0,
    gateBlocks: session.gateBlocks ?? {},
    waivers: ["Test-Waiver", "Docs-Waiver", "Broad-Change-Reason"].filter((name) => trailers[name]),
    approvalEvidence: trailers["Approval-Evidence"] ?? null,
    decisions: (session.brief?.decisions?.length ?? 0) + (session.brief?.nonGoals?.length ?? 0),
    review: session.review ? { level: session.review.level, required: session.review.required, found: session.review.found, fixed: session.review.fixed } : null,
    commit,
  };
  writeJson(historyPath(cwd), { version: 1, concerns: [...readHistory(cwd), entry].slice(-KEEP) });
  return entry;
}

// Session counters the history summarizes later.
export function countGateBlocks(session, rules) {
  const gateBlocks = { ...(session.gateBlocks ?? {}) };
  for (const rule of new Set(rules)) gateBlocks[rule] = (gateBlocks[rule] ?? 0) + 1;
  return { ...session, gateBlocks };
}
