// Guarded save: approval, finalizing phase, lifecycle gate, matching receipt,
// concern categories, then commit with permanent trailers.
import { output } from "../lib/exec.mjs";
import { isNonTechnical, loadConfig } from "../lib/config.mjs";
import { readJson } from "../lib/fs-safe.mjs";
import { commit, hasUnpushedCommits, head, push, stagedFiles } from "../lib/git.mjs";
import { matchesAny } from "../lib/glob.mjs";
import { failed, ok, refused } from "../lib/output.mjs";
import { readReceipt, receiptMatches } from "../lib/receipt.mjs";
import { CLI, markSaved, markSynced, readSession, requireBrief, requireFinalizing, requireOpenSession, sessionTouchesSource, writeSession } from "../lib/session.mjs";
import { assetPath } from "../lib/toolkit.mjs";
import { validateReason, validateWaiver } from "../lib/waivers.mjs";
import { formatFinding, runLifecycle } from "./lifecycle.mjs";

export const description = "Save the verified batch as one commit after explicit operator approval.";
export const usage = 'STAFF_ENGINEER_CHANGE_APPROVED=1 ship "<imperative message>" [--push]  |  ship --sync-only';

export default async function run({ cwd, positional, flags, env = process.env }) {
  const config = loadConfig(cwd);
  if (flags["sync-only"]) return syncOnly(cwd, config);

  const session = requireOpenSession(cwd);
  requireBrief(session);
  requireFinalizing(session);

  if (env.STAFF_ENGINEER_CHANGE_APPROVED !== "1") {
    throw refused("Saving needs the operator's explicit approval of the finished batch.", {
      agent: `Run ${CLI} handoff, send it, and wait for "ship it". Then: STAFF_ENGINEER_CHANGE_APPROVED=1 ${CLI} ship "Imperative message". Praise for the preview is not approval to save.`,
    });
  }
  const message = positional.join(" ").trim();
  if (message.length < 10) throw refused("Give the saved change a short imperative message (at least 10 characters).", { agent: `Usage: ${usage}` });

  const staged = stagedFiles(cwd);
  if (!staged.length) throw refused("Nothing is staged to save.", { agent: "Stage the entire concern, run lifecycle and verify --mode full, then ship." });

  const gate = runLifecycle(cwd, config, env);
  if (gate.blocking.length) {
    throw failed(`The staged batch still has ${gate.blocking.length} lifecycle issue${gate.blocking.length === 1 ? "" : "s"}.`, {
      errors: gate.blocking.map(formatFinding),
      agent: "Fix them and run lifecycle, then verify --mode full again if code changed.",
      data: gate,
    });
  }

  const receipt = readReceipt(cwd, "full");
  if (sessionTouchesSource(session, config, cwd) || hasConfiguredGates(config)) {
    if (!receiptMatches(receipt, cwd, config, "staged")) {
      throw refused("The staged code has not passed the full check in its current form.", {
        agent: `Run ${CLI} verify --mode full against this exact staged batch, then ship again. Docs-only edits after a passing full check do not require a rerun.`,
      });
    }
  }
  output("git", ["diff", "--cached", "--check"], { cwd });

  const trailers = {};
  const categories = concernCategories(staged);
  if (categories.length > config.rules.maxConcernCategories) {
    const reason = validateReason(env.STAFF_ENGINEER_BROAD_CHANGE_REASON, { name: "STAFF_ENGINEER_BROAD_CHANGE_REASON" });
    if (!reason.ok) {
      throw refused(`This batch spans ${categories.length} areas (${categories.join(", ")}); the limit is ${config.rules.maxConcernCategories}.`, {
        agent: `Split it into separate concerns, or if the operator explicitly authorized one cohesive change, set STAFF_ENGINEER_BROAD_CHANGE_REASON="why every area must be saved together" (40-500 chars, 8+ words). ${reason.error}`,
      });
    }
    trailers["Broad-Change-Reason"] = reason.value;
  }
  for (const [envName, trailer] of [["STAFF_ENGINEER_TEST_WAIVER", "Test-Waiver"], ["STAFF_ENGINEER_DOCS_WAIVER", "Docs-Waiver"]]) {
    const waiver = validateWaiver(env[envName], envName);
    if (waiver.ok) trailers[trailer] = waiver.value;
  }
  trailers["Brief-Outcome"] = session.brief.outcome;

  const savedCommit = commit(message, { cwd, trailers });
  let updated = markSaved(session, savedCommit);
  let pushed = false;
  const remote = hasRemote(cwd);
  if (flags.push && remote) {
    push(cwd);
    pushed = true;
  }
  if (pushed || !remote) updated = markSynced(updated);
  writeSession(cwd, updated);

  const plain = isNonTechnical(config);
  return ok({
    operator: plain
      ? `Saved.${pushed ? " It is also sent to the shared copy of the project." : remote ? " It still needs to be sent to the shared copy of the project." : ""}`
      : `Committed ${savedCommit.slice(0, 10)} on ${branchName(cwd)}${pushed ? " and pushed." : remote ? " (not pushed)." : "."}`,
    agent: updated.status === "saved"
      ? `Saved as ${savedCommit}. Run ${CLI} ship --sync-only to push before opening another concern.`
      : `Saved as ${savedCommit}. The session is complete; open the next concern with ${CLI} begin.`,
    data: { commit: savedCommit, pushed, status: updated.status, categories, trailers },
  });
}

function syncOnly(cwd, config) {
  const session = readSession(cwd);
  if (!session || session.status !== "saved") throw refused("There is no saved batch waiting to be synced.");
  if (session.savedCommit !== head(cwd)) throw refused("The saved batch is not the current checkout. Return to it before syncing.");
  if (!hasRemote(cwd)) {
    writeSession(cwd, markSynced(session));
    return ok({ operator: "Nothing to send: this project has no shared copy configured.", data: { status: "synced" } });
  }
  push(cwd);
  if (hasUnpushedCommits(cwd)) throw failed("The push did not deliver every saved change.", { agent: "Check the remote and network, then run ship --sync-only again." });
  writeSession(cwd, markSynced(session));
  return ok({ operator: isNonTechnical(config) ? "Sent to the shared copy of the project." : "Pushed.", data: { status: "synced" } });
}

function hasConfiguredGates(config) {
  return Object.values(config.gates ?? {}).some((gate) => gate !== null);
}

function hasRemote(cwd) {
  return output("git", ["remote"], { cwd, allowFailure: true }).split(/\r?\n/).some((line) => line.trim() === "origin");
}

function branchName(cwd) {
  return output("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, allowFailure: true }) || "HEAD";
}

// Concern categories: source areas only. Docs, tests, and config are required
// companions of every batch and never count toward the limit.
export function concernCategories(files, buckets = readJson(assetPath("rules", "structural.json")).categoryBuckets) {
  const categories = new Set();
  for (const file of files) {
    if (Object.values(buckets).some((globs) => matchesAny(file, globs))) continue;
    const parts = file.split("/");
    categories.add(parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join("/") : "(root)");
  }
  return [...categories].sort();
}
