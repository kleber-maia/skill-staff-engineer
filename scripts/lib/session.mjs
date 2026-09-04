// One concern, one session, one saved batch. This module owns the state machine;
// commands call the guards and transitions and never edit the record directly.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { baselineUnchanged, captureBaseline, concernFiles } from "./baseline.mjs";
import { head, stateDir } from "./git.mjs";
import { readJson, writeJson } from "./fs-safe.mjs";
import { refused } from "./output.mjs";
import { classify } from "./paths.mjs";

export const SESSION_VERSION = 1;
export const PHASES = Object.freeze({ IMPLEMENTATION: "implementation", AWAITING_FEEDBACK: "awaiting_feedback", FINALIZING: "finalizing" });
export const STATUSES = Object.freeze({ OPEN: "open", SAVED: "saved", SYNCED: "synced" });
export const CLI = "node .staff-engineer/cli.mjs";

export function sessionPath(cwd) {
  return join(stateDir(cwd), "session.json");
}

export function readSession(cwd) {
  const path = sessionPath(cwd);
  if (!existsSync(path)) return null;
  const session = readJson(path);
  if (session?.version !== SESSION_VERSION) {
    throw refused("The local work-session record uses an unsupported version. Remove it and start the concern again.", {
      agent: `Inspect and delete ${path}, then run ${CLI} begin "..." again.`,
    });
  }
  return session;
}

export function writeSession(cwd, session) {
  writeJson(sessionPath(cwd), session);
  return session;
}

export function clearSession(cwd) {
  const path = sessionPath(cwd);
  if (existsSync(path)) writeJson(path, { version: SESSION_VERSION, status: STATUSES.SYNCED, cleared: true, clearedAt: new Date().toISOString() });
}

// ---------- begin ----------
export function beginSession(cwd, concern, { now = new Date().toISOString() } = {}) {
  assertConcern(concern);
  const existing = readSession(cwd);
  const currentHead = head(cwd);
  assertCanBegin(existing, currentHead, existing ? baselineUnchanged(existing.baseline, cwd) : true);
  const session = {
    version: SESSION_VERSION,
    status: STATUSES.OPEN,
    phase: PHASES.IMPLEMENTATION,
    concern: concern.trim(),
    baseCommit: currentHead,
    startedAt: now,
    reviewRound: 0,
    baseline: captureBaseline(cwd),
  };
  return writeSession(cwd, session);
}

export function assertCanBegin(existing, currentHead, baselineMatches) {
  if (!existing || existing.cleared) return;
  if (existing.status === STATUSES.OPEN) {
    throw refused(`A work session is already open for "${existing.concern}". Finish that concern before opening another.`, {
      agent: `Continue the open concern, or run ${CLI} abort if it was abandoned.`,
    });
  }
  if (existing.status === STATUSES.SAVED) {
    throw refused("The previous concern was saved but not synced yet.", {
      agent: `Run ${CLI} ship --sync-only (or push manually) before opening another concern.`,
    });
  }
  if (existing.status !== STATUSES.SYNCED) {
    throw refused("The local work-session record is invalid. Resolve it before starting another concern.");
  }
  if (existing.savedCommit && currentHead && existing.savedCommit !== currentHead && !baselineMatches) {
    throw refused("Pending files changed after the previous concern. Finish or restore that work before opening another concern.");
  }
}

// ---------- guards ----------
export function requireOpenSession(cwd) {
  const session = readSession(cwd);
  if (!session || session.cleared) {
    throw refused("No work session is open.", { agent: `Run ${CLI} begin "Short concern" before making changes.` });
  }
  if (session.status !== STATUSES.OPEN) {
    throw refused("The current work session is already saved. Start a new concern before continuing.", {
      agent: `Run ${CLI} begin "Short concern".`,
    });
  }
  const currentHead = head(cwd);
  if (session.baseCommit !== currentHead) {
    throw refused("The checkout changed after this work session began.", {
      agent: "Return to the commit the session started on, or abort the session and begin again.",
    });
  }
  if (!baselineUnchanged(session.baseline, cwd)) {
    throw refused("Files that were already pending before this concern have changed. Keep existing work separate from the current batch.", {
      agent: `Restore these files to their state at session start, or abort and begin again: ${session.baseline.files.join(", ")}`,
    });
  }
  return session;
}

export function requireBrief(session) {
  if (!session.brief) {
    throw refused("No brief is recorded for this concern yet.", {
      agent: `Agree the outcome with the operator (grill-me skill), then run ${CLI} brief --outcome "..." --accept "..." before presenting or finishing work.`,
    });
  }
  return session.brief;
}

export function requireFinalizing(session) {
  if (session.phase !== PHASES.FINALIZING) {
    throw refused("Final checks wait until the operator has reviewed the working result and accepted it.", {
      agent: `Run ${CLI} preview, wait for feedback, then STAFF_ENGINEER_PREVIEW_APPROVED=1 ${CLI} finalize.`,
    });
  }
}

// Tests and verification wait for operator feedback when the concern touches
// product source. A concern that changes only docs/tooling/tests has nothing to preview.
export function sessionTouchesSource(session, config, cwd) {
  return concernFiles(session.baseline, cwd).some((file) => classify(config, file) === "source");
}

export function assertMayRunChecks(session, config, cwd) {
  if (session.phase === PHASES.FINALIZING) return;
  if (!sessionTouchesSource(session, config, cwd)) return;
  requireFinalizing(session);
}

// ---------- transitions ----------
export function recordBrief(session, brief, { now = new Date().toISOString() } = {}) {
  return { ...session, brief: { ...normalizeBrief(brief), recordedAt: now } };
}

export function normalizeBrief({ outcome, accept = [], nonGoals = [], surfaces = [] } = {}) {
  const cleanOutcome = String(outcome ?? "").trim();
  if (cleanOutcome.length < 12) {
    throw refused("The brief needs a one-sentence outcome in plain language.", { agent: "Pass --outcome \"What the operator gets, in one sentence\"." });
  }
  const acceptance = cleanList(accept);
  if (!acceptance.length) {
    throw refused("The brief needs at least one acceptance check the operator can perform.", { agent: "Pass --accept \"Open ... and confirm ...\" (repeatable)." });
  }
  return { outcome: cleanOutcome, acceptance, nonGoals: cleanList(nonGoals), surfaces: cleanList(surfaces) };
}

export function markAwaitingFeedback(session, presentedFiles, { now = new Date().toISOString() } = {}) {
  if (session.phase !== PHASES.IMPLEMENTATION) {
    throw refused("Return this concern to implementation before presenting another preview.", { agent: `Run ${CLI} revise first.` });
  }
  return { ...session, phase: PHASES.AWAITING_FEEDBACK, reviewRound: (session.reviewRound ?? 0) + 1, presentedAt: now, presentedFiles, acceptedAt: undefined };
}

export function markRevising(session, { now = new Date().toISOString() } = {}) {
  if (session.phase === PHASES.IMPLEMENTATION) {
    throw refused("This concern is already in implementation.", { agent: "Keep building, then run preview again." });
  }
  return { ...session, phase: PHASES.IMPLEMENTATION, resumedAt: now, acceptedAt: undefined };
}

export function markFinalizing(session, { now = new Date().toISOString() } = {}) {
  if (session.phase !== PHASES.AWAITING_FEEDBACK) {
    throw refused("Present the working result and wait for the operator's feedback before finalizing.", { agent: `Run ${CLI} preview first.` });
  }
  return { ...session, phase: PHASES.FINALIZING, acceptedAt: now };
}

export function markSaved(session, savedCommit, { now = new Date().toISOString() } = {}) {
  return { ...session, status: STATUSES.SAVED, savedCommit, savedAt: now };
}

export function markSynced(session, { now = new Date().toISOString() } = {}) {
  return { ...session, status: STATUSES.SYNCED, syncedAt: now };
}

// ---------- helpers ----------
export function sessionConcernFiles(session, cwd) {
  return concernFiles(session.baseline, cwd);
}

function assertConcern(concern) {
  if (!concern || concern.trim().length < 8) {
    throw refused("Describe the one concern being worked on in a short phrase (at least 8 characters).", {
      agent: `Usage: ${CLI} begin "Short description of the single concern"`,
    });
  }
}

function cleanList(values) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value ?? "").trim()).filter(Boolean))];
}
