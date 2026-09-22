// Guarded save: approval, finalizing phase, lifecycle gate, matching receipt,
// concern categories, then commit with permanent trailers.
import { approvalTrailers, checkApproval } from "../lib/approval.mjs";
import { appendDecisions } from "../lib/decisions.mjs";
import { output } from "../lib/exec.mjs";
import { recordConcern } from "../lib/history.mjs";
import { operatorInsight } from "../lib/insights.mjs";
import { isNonTechnical, loadConfig } from "../lib/config.mjs";
import { readJson } from "../lib/fs-safe.mjs";
import { commit, hasUnpushedCommits, head, push, stagedFiles } from "../lib/git.mjs";
import { matchesAny } from "../lib/glob.mjs";
import { isProductSource } from "../lib/paths.mjs";
import { laneOf, sameFingerprint, sourceFingerprint } from "../lib/lanes.mjs";
import { failed, ok, refused } from "../lib/output.mjs";
import { codeTreeFingerprint, readReceipt, receiptMatches } from "../lib/receipt.mjs";
import { rank, requiredReview } from "../lib/review.mjs";
import { CLI, markSaved, markSynced, readSession, requireBrief, requireFinalizing, requireOpenSession, sessionTouchesSource, writeSession } from "../lib/session.mjs";
import { assetPath } from "../lib/toolkit.mjs";
import { validateReason, validateWaiver } from "../lib/waivers.mjs";
import { formatFinding, recordBlocks, runLifecycle } from "./lifecycle.mjs";
import { reviewTrailer } from "./review.mjs";

export const description = "Save the verified batch as one commit after explicit operator approval.";
export const usage = 'ship "<imperative message>" --approval-quote "<the operator\'s exact words>" [--push]  |  ship --sync-only';

export default async function run({ cwd, positional, flags, env = process.env }) {
  const config = loadConfig(cwd);
  if (flags["sync-only"]) return syncOnly(cwd, config);

  const session = requireOpenSession(cwd);
  requireBrief(session);
  requireFinalizing(session);

  const receipt = readReceipt(cwd, "full");
  const approval = saveApproval(cwd, config, session, receipt, flags["approval-quote"]);
  const message = positional.join(" ").trim();
  if (message.length < 10) throw refused("Give the saved change a short imperative message (at least 10 characters).", { agent: `Usage: ${usage}` });

  const staged = stagedFiles(cwd);
  if (!staged.length) throw refused("Nothing is staged to save.", { agent: "Stage the entire concern, run lifecycle and verify --mode full, then ship." });

  const gate = runLifecycle(cwd, config, env);
  if (gate.blocking.length) {
    recordBlocks(cwd, gate.blocking);
    throw failed(`The staged batch still has ${gate.blocking.length} lifecycle issue${gate.blocking.length === 1 ? "" : "s"}.`, {
      errors: gate.blocking.map(formatFinding),
      agent: "Fix them and run lifecycle, then verify --mode full again if code changed.",
      data: gate,
    });
  }

  if (sessionTouchesSource(session, config, cwd) || hasConfiguredGates(config)) {
    if (!receiptMatches(receipt, cwd, config, "staged")) {
      throw refused("The staged code has not passed the full check in its current form.", {
        agent: `Run ${CLI} verify --mode full against this exact staged batch, then ship again. Prose-only edits after a passing full check do not require a rerun.`,
      });
    }
  }
  output("git", ["diff", "--cached", "--check"], { cwd });
  const review = requireReview(cwd, config, session);

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
  if (review) {
    trailers.Review = reviewTrailer(review);
    if (review.reason) trailers["Review-Downgrade"] = review.reason;
  }
  Object.assign(trailers, approvalTrailers(approval));

  // Decisions travel with the change that made them; the log is toolkit data, not verified code.
  const decisionsFile = appendDecisions(cwd, session, { files: staged.filter((file) => isProductSource(config, file)) });
  if (decisionsFile) output("git", ["add", "--", decisionsFile], { cwd });

  const savedCommit = commit(message, { cwd, trailers });
  let updated = markSaved(session, savedCommit);
  writeSession(cwd, updated);
  recordConcern(cwd, session, { outcome: "saved", commit: savedCommit, trailers });
  const milestone = operatorInsight(cwd);
  let pushed = false;
  const remote = hasRemote(cwd);
  if (flags.push && remote) {
    push(cwd);
    pushed = true;
  }
  if (pushed || !remote) updated = markSynced(updated);
  if (updated.status !== "saved") writeSession(cwd, updated);

  const plain = isNonTechnical(config);
  return ok({
    operator: [
      plain
        ? `Saved.${pushed ? " It is also sent to the shared copy of the project." : remote ? " It still needs to be sent to the shared copy of the project." : ""}`
        : `Committed ${savedCommit.slice(0, 10)} on ${branchName(cwd)}${pushed ? " and pushed." : remote ? " (not pushed)." : "."}`,
      milestone?.message ?? "",
    ].filter(Boolean).join(" "),
    agent: updated.status === "saved"
      ? `Saved as ${savedCommit}. Run ${CLI} ship --sync-only to push before opening another concern.`
      : `Saved as ${savedCommit}. The session is complete; open the next concern with ${CLI} begin.`,
    data: { commit: savedCommit, pushed, status: updated.status, categories, trailers, decisionsRecorded: Boolean(decisionsFile) },
  });
}

// The review must cover this exact staged code at the level the change needs now.
function requireReview(cwd, config, session) {
  const required = requiredReview(cwd, config, session);
  if (!required.level) return null;
  const review = session.review;
  if (!review || review.codeTree !== codeTreeFingerprint(cwd, config, "staged").digest) {
    throw refused("The code has not been reviewed in its current form.", {
      agent: `Run ${CLI} review${review ? " (it prepares only the changes since the last review)" : ""}, act on the findings, and record it with review done.`,
    });
  }
  if (rank(review.level) < rank(required.level) && !review.reason) {
    throw refused(`This change now needs a ${required.level} review (${required.reasons.join("; ")}).`, { agent: `Run ${CLI} review again at ${required.level}.` });
  }
  return review;
}

// Trivial lane: the preview asked the save question, so its approval stands while
// the source is byte-identical to what the operator saw. Otherwise the approval
// must answer a handoff of this exact verified receipt.
function saveApproval(cwd, config, session, receipt, quote) {
  if (laneOf(session) === "trivial" && session.presentedSource && session.acceptance) {
    if (!sameFingerprint(session.presentedSource, sourceFingerprint(cwd, config, session))) {
      throw refused("The change was edited after the operator approved it, so they have not seen this version.", {
        agent: `Run ${CLI} revise, then preview the final version again.`,
      });
    }
    return session.acceptance;
  }
  if (!receipt || session.handoff?.receiptAt !== receipt.at) {
    throw refused("Saving needs the operator's approval of a handoff for this exact verified batch.", {
      agent: `Run ${CLI} lifecycle and verify --mode full if needed, then ${CLI} handoff, send it, and wait. Praise for the preview is not approval to save.`,
    });
  }
  return checkApproval(cwd, quote, { since: session.handoff.at, purpose: "Saving" });
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
