import { hasConfig, loadConfig } from "../lib/config.mjs";
import { head } from "../lib/git.mjs";
import { ok } from "../lib/output.mjs";
import { readReceipt, receiptMatches } from "../lib/receipt.mjs";
import { readSession, sessionConcernFiles } from "../lib/session.mjs";
import { toolkitVersion } from "../lib/toolkit.mjs";

export const description = "Show the current session, brief, and verification receipt.";
export const usage = "status [--json]";

export default async function run({ cwd }) {
  const installed = hasConfig(cwd);
  const config = installed ? loadConfig(cwd) : null;
  const session = readSession(cwd);
  const active = session && !session.cleared && session.status === "open" ? session : null;
  const receipt = readReceipt(cwd);
  const data = {
    toolkitVersion: toolkitVersion(),
    installed,
    configVersion: config?.toolkitVersion ?? null,
    head: head(cwd),
    session: session ?? null,
    concernFiles: active ? sessionConcernFiles(active, cwd) : [],
    receipt: receipt ? { ...receipt, current: config ? receiptMatches(receipt, cwd, config, "working") : false } : null,
  };
  return ok({ operator: describe(data), agent: nextStep(data), data });
}

function describe(data) {
  if (!data.installed) return "The staff-engineer toolkit is not installed in this project.";
  if (!data.session || data.session.cleared || data.session.status === "synced") return "No work is in progress.";
  if (data.session.status === "saved") return `The concern "${data.session.concern}" is saved and waiting to be synced.`;
  const phase = { implementation: "being built", awaiting_feedback: "waiting for your feedback on the preview", finalizing: "accepted and being finished" }[data.session.phase];
  return `Working on "${data.session.concern}" (${phase}).${data.session.brief ? "" : " No brief recorded yet."}`;
}

function nextStep(data) {
  if (!data.installed) return "Run the installer (install skill).";
  const s = data.session;
  if (!s || s.cleared || s.status === "synced") return 'Open a concern with: node .staff-engineer/cli.mjs begin "Short concern"';
  if (s.status === "saved") return "Run: node .staff-engineer/cli.mjs ship --sync-only";
  if (!s.brief) return "Interview the operator (grill-me skill), then record the brief.";
  if (s.phase === "implementation") return "Build the smallest working first pass, then run preview. No tests, review, or verification yet.";
  if (s.phase === "awaiting_feedback") return "Wait for the operator. On change requests run revise; on clear acceptance run STAFF_ENGINEER_PREVIEW_APPROVED=1 ... finalize.";
  return data.receipt?.current ? "Run handoff and ask for approval; after \"ship it\" run the approved ship." : "Tests, simplify, docs, then lifecycle and verify --mode full.";
}
