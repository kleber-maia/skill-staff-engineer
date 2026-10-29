import { assertActive, isGuided, modeOf } from "../lib/autonomy.mjs";
import { requireAcceptance } from "../lib/acceptance.mjs";
// Guarded save: approval, finalizing phase, lifecycle gate, matching receipt,
// concern categories, then commit with permanent trailers.
import { approvalStillCurrent, approvalTrailers, assertDeliveryNotWithdrawn, checkApproval } from "../lib/approval.mjs";
import { appendDecisions } from "../lib/decisions.mjs";
import { applyIssues } from "../lib/issues.mjs";
import { output } from "../lib/exec.mjs";
import { recordConcern } from "../lib/history.mjs";
import { operatorInsight } from "../lib/insights.mjs";
import { isNonTechnical, loadConfig } from "../lib/config.mjs";
import { acquireSaveLock, readJson } from "../lib/fs-safe.mjs";
import { commit, head, stagedFiles, stateDir } from "../lib/git.mjs";
import { matchesAny } from "../lib/glob.mjs";
import { isProductSource } from "../lib/paths.mjs";
import { laneOf, sameFingerprint, sourceFingerprint } from "../lib/lanes.mjs";
import { failed, ok, refused } from "../lib/output.mjs";
import { batchFingerprint, codeTreeFingerprint, readReceipt, receiptMatches } from "../lib/receipt.mjs";
import { commitMatches, deliver, shippingTarget } from "../lib/shipping.mjs";
import { rank, requiredReview } from "../lib/review.mjs";
import { CLI, markRevising, markSaved, markSynced, readSession, requireBrief, requireFinalizing, requireOpenSession, sessionConcernFiles, sessionTouchesSource, writeSession } from "../lib/session.mjs";
import { assetPath } from "../lib/toolkit.mjs";
import { validateReason, validateWaiver } from "../lib/waivers.mjs";
import { formatFinding, recordBlocks, runLifecycle } from "./lifecycle.mjs";
import { reproIsCurrent, reproTrailers } from "./repro.mjs";
import { reviewTrailer } from "./review.mjs";

export const description = "Save the verified batch as one commit with confirmed delivery after explicit operator approval.";
export const usage = 'ship "<imperative message>" --approval-quote "<the operator\'s exact words>"  |  ship --sync-only  |  ship --recover';

export default async function run(options) {
  const release = acquireSaveLock(stateDir(options.cwd));
  try { return await runShip(options); } finally { release(); }
}

async function runShip({ cwd, positional, flags, env = process.env }) {
  const config = loadConfig(cwd);
  assertActive(cwd, readSession(cwd));
  if (flags.recover) return recover(cwd);
  if (flags["sync-only"]) return syncOnly(cwd, config, flags);
  const existing = readSession(cwd);
  if (existing?.status === "saved" || existing?.status === "open" && existing.shipping && head(cwd) !== existing.baseCommit) return syncOnly(cwd, config, flags);
  if (existing?.status === "open" && existing.shipping) {
    if (output("git", ["write-tree"], { cwd }) !== existing.shipping.expectedTree) throw refused("The batch changed during an interrupted save.", { agent: "Run ship --recover and review the changed batch again." });
    const approval = flags["approval-quote"]
      ? checkApproval(cwd, flags["approval-quote"], { since: existing.handoff?.at ?? existing.presentedAt, purpose: "Saving" })
      : existing.shipping.approval;
    assertSaveAuthority(existing, approval);
    approvalStillCurrent(cwd, approval);
    const shipping = { ...existing.shipping, approval, trailers: { ...existing.shipping.trailers, ...approvalTrailers(approval) } };
    writeSession(cwd, { ...existing, shipping });
    const savedCommit = commit(shipping.message, { cwd, trailers: shipping.trailers });
    writeSession(cwd, markSaved({ ...existing, shipping }, savedCommit));
    return completeDelivery(cwd, config, readSession(cwd));
  }

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
  if (session.kind === "bug" && !reproIsCurrent(cwd, config, session, "staged")) {
    throw refused("This bug fix has no current proof that its test fails without the fix and passes with it.", {
      agent: `Run ${CLI} repro "<test command>" on the final code, then ship again.`,
    });
  }

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
  if (session.kind === "bug") Object.assign(trailers, reproTrailers(session.repro));
  if (review) {
    trailers.Review = reviewTrailer(review);
    if (review.reason) trailers["Review-Downgrade"] = review.reason;
    if (review.refutations?.length) trailers["Review-Refutations"] = review.refutations.join("; ");
  }
  Object.assign(trailers, approvalTrailers(approval));

  const target = shippingTarget(cwd, config);
  if (flags.push && !target) throw refused("Pushing was requested, but no shipping destination is configured.", { agent: "Configure a remote and shipping destination, or intentionally save this as local work without --push." });
  // Decisions travel with the change that made them; the log is toolkit data, not verified code.
  const decisionsFile = appendDecisions(cwd, session, { files: staged.filter((file) => isProductSource(config, file)) });
  if (decisionsFile) output("git", ["add", "--", decisionsFile], { cwd });
  const issuesFile = applyIssues(cwd, session);
  if (issuesFile) output("git", ["add", "--", issuesFile], { cwd });

  const shipping = { deployment: config.deployment, baseCommit: session.baseCommit, expectedTree: output("git", ["write-tree"], { cwd }), target, approval, trailers, message };
  // Durable before Git runs: a crash after commit can recover from HEAD + tree.
  writeSession(cwd, { ...session, shipping });
  const savedCommit = commit(message, { cwd, trailers });
  writeSession(cwd, markSaved({ ...session, shipping }, savedCommit));
  return completeDelivery(cwd, config, readSession(cwd), categories, Boolean(decisionsFile));
}

function completeDelivery(cwd, config, session, categories = [], decisionsRecorded = false) {
  const savedCommit = session.savedCommit;
  if (session.shipping && !commitMatches(cwd, savedCommit, session.shipping)) {
    throw refused("Commit hooks changed the approved batch. It has not been sent.", {
      agent: `Inspect the saved commit. To keep every change and return to review, run git reset --soft ${session.baseCommit}, then ${CLI} ship --recover. Preview, review, verify, and approve the resulting batch again. Never bypass the mismatch.`,
      data: { commit: savedCommit, deliveryPending: true, expectedTree: session.shipping.expectedTree },
    });
  }
  assertActive(cwd, session);
  assertSaveAuthority(session, session.shipping?.approval);
  assertDeliveryNotWithdrawn(cwd, session.shipping?.approval);
  const pushed = deliver(cwd, savedCommit, session.shipping ? session.shipping.target : shippingTarget(cwd, config));
  const deploymentConfig = session.shipping?.deployment;
  const updated = { ...markSynced(session), delivery: pushed ? "remote" : "local", ...(deploymentConfig ? { status: "delivered", deployment: { status: "pending", config: deploymentConfig } } : {}) };
  // History represents completed operations. Recovery after a push reuses the commit.
  recordConcern(cwd, session, { outcome: "saved", commit: savedCommit, trailers: session.shipping?.trailers ?? {} });
  writeSession(cwd, updated);
  const milestone = operatorInsight(cwd);

  const plain = isNonTechnical(config);
  return ok({
    operator: [
      plain
        ? pushed ? "Saved and sent to the shared copy of the project." : "Saved locally."
        : `Committed ${savedCommit.slice(0, 10)} on ${branchName(cwd)}${pushed ? " and confirmed delivery." : " (local work)."}`,
      milestone?.message ?? "",
    ].filter(Boolean).join(" "),
    agent: deploymentConfig ? `Saved as ${savedCommit}. Deployment is pending: run ${CLI} deploy and verify the live result before reporting completion.` : `Saved as ${savedCommit}. The session is complete; open the next concern with ${CLI} begin.`,
    data: { commit: savedCommit, pushed, delivery: updated.delivery, status: updated.status, categories, trailers: session.shipping?.trailers ?? {}, decisionsRecorded },
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
// the entire batch stays exactly as presented. Otherwise the approval
// must answer a handoff of this exact verified receipt.
function saveApproval(cwd, config, session, receipt, quote) {
  if (!isGuided(session)) requireAcceptance(cwd, config, session);
  if (isGuided(session) && laneOf(session) === "trivial" && session.presentedSource && session.acceptance) {
    approvalStillCurrent(cwd, session.acceptance);
    if (!sameFingerprint(session.presentedSource, sourceFingerprint(cwd, config, session))) {
      throw refused("The change was edited after the operator approved it, so they have not seen this version.", {
        agent: `Run ${CLI} revise, then preview the final version again.`,
      });
    }
    return session.acceptance;
  }
  if (!receipt || session.handoff?.receiptAt !== receipt.at || session.handoff?.batch !== batchFingerprint(cwd, "staged", sessionConcernFiles(session, cwd)).digest) {
    throw refused("Saving needs the operator's approval of a handoff for this exact verified batch.", {
      agent: `Run ${CLI} lifecycle and verify --mode full if needed, then ${CLI} handoff, send it, and wait. Praise for the preview is not approval to save.`,
    });
  }
  if (modeOf(session) === "autonomous") return { evidence: "autonomy-policy", mode: "autonomous", authority: session.autonomy };
  return checkApproval(cwd, quote, { since: session.handoff.at, purpose: "Saving" });
}

function syncOnly(cwd, config, flags = {}) {
  let session = readSession(cwd);
  if (session?.status === "open" && session.shipping) {
    const savedCommit = head(cwd);
    if (savedCommit === session.baseCommit) throw refused("No commit was created yet.", { agent: "Fix the commit failure, then rerun ship with approval; or run ship --recover to return to review." });
    // A crash may have occurred before the saved state was persisted.
    if (output("git", ["show", "-s", "--format=%P", savedCommit], { cwd }) !== (session.baseCommit ?? "")) throw refused("The checkout changed during an interrupted save. Inspect it before recovery.");
    session = markSaved(session, savedCommit);
    writeSession(cwd, session);
  }
  if (!session || session.status !== "saved") throw refused("There is no saved batch waiting to be synced.");
  if (session.savedCommit !== head(cwd)) throw refused("The saved batch is not the current checkout. Return to it before syncing.");
  // A pending remote delivery never silently becomes local after configuration edits.
  if (!session.shipping) session = { ...session, shipping: { baseCommit: session.baseCommit, expectedTree: output("git", ["rev-parse", `${session.savedCommit}^{tree}`], { cwd }), target: shippingTarget(cwd, config) } };
  if (flags["approval-quote"]) {
    session = { ...session, shipping: { ...session.shipping, approval: checkApproval(cwd, flags["approval-quote"], { since: session.savedAt, purpose: "Resuming delivery" }) } };
    writeSession(cwd, session);
  }
  return completeDelivery(cwd, config, session);
}

function recover(cwd) {
  const session = readSession(cwd);
  if (!session?.shipping || head(cwd) !== session.baseCommit) throw refused("Recovery needs the original checkout with the saved changes kept in the index.", { agent: "Inspect the pending save and follow its soft-reset instructions first. Recovery never discards files." });
  const updated = markRevising({ ...session, phase: "finalizing", status: "open", shipping: undefined, savedCommit: undefined });
  writeSession(cwd, updated);
  return ok({ operator: "The changes are kept and ready to review again.", agent: `Run ${CLI} next; the revised batch needs a fresh preview and approval.`, data: { phase: updated.phase } });
}

function hasConfiguredGates(config) {
  return Object.values(config.gates ?? {}).some((gate) => gate !== null);
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

function assertSaveAuthority(session, approval) {
  if (approval?.evidence === "autonomy-policy" && modeOf(session) !== "autonomous") throw refused("Autonomous delivery was withdrawn. Obtain approval for this pending batch before resuming with --approval-quote.");
}
