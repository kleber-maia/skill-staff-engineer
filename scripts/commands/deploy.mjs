import { assertActive, modeOf } from "../lib/autonomy.mjs";
import { assertDeliveryNotWithdrawn, checkApproval } from "../lib/approval.mjs";
import { loadConfig } from "../lib/config.mjs";
import { runShell } from "../lib/exec.mjs";
import { acquireSaveLock } from "../lib/fs-safe.mjs";
import { dirtyFiles, head, stateDir } from "../lib/git.mjs";
import { ok, refused } from "../lib/output.mjs";
import { markSynced, readSession, writeSession } from "../lib/session.mjs";

export const description = "Deploy the delivered revision and verify it is live using the project's configured commands.";
export const usage = 'deploy [--retry --reason "why retrying is safe"] [--approval-quote "..."]';
export default async function run(options) {
  const release = acquireSaveLock(stateDir(options.cwd));
  try { return await deploy(options); } finally { release(); }
}

async function deploy({ cwd, flags = {} }) {
  loadConfig(cwd);
  let session = readSession(cwd);
  assertActive(cwd, session);
  if (session?.status !== "delivered" || !session.deployment) throw refused("There is no delivered batch waiting for deployment.");
  if (head(cwd) !== session.savedCommit) throw refused("Return to the delivered revision before deploying it.");
  if (dirtyFiles(cwd).length) throw refused("Deployment needs a clean checkout of the delivered revision.", { agent: "Preserve pending work. Resolve the dirty checkout or use the project’s revision-based deployment integration before retrying; never deploy unverified local edits." });
  if (flags["approval-quote"]) {
    session = { ...session, shipping: { ...session.shipping, approval: checkApproval(cwd, flags["approval-quote"], { since: session.savedAt, purpose: "Deployment" }) } };
    writeSession(cwd, session);
  }
  if (session.shipping?.approval?.evidence === "autonomy-policy" && modeOf(session) !== "autonomous") throw refused("Autonomous deployment was withdrawn. Obtain approval before continuing with --approval-quote.");
  assertDeliveryNotWithdrawn(cwd, session.shipping?.approval);
  const deployment = session.deployment;
  const config = deployment.config; // Destination and commands were fixed before saving.
  const options = { cwd, timeoutMs: config.timeoutMs, env: { ...process.env, STAFF_ENGINEER_COMMIT: session.savedCommit, STAFF_ENGINEER_DEPLOY_ENVIRONMENT: config.environment } };
  // On recovery first check whether the exact revision already went live. Never
  // blindly issue the deploy command again after an interrupted side effect.
  if (deployment.status !== "pending") {
    if (runShell(config.verifyCmd, options).ok) return finish(cwd, session);
    if (!flags.retry || String(flags.reason ?? "").trim().length < 12) throw refused("The expected revision is not verified live. Investigate before retrying deployment.", { agent: "Repair the cause, then use deploy --retry --reason explaining why repeating the deployment is safe. The same commit and destination are retained." });
  }
  session = { ...session, deployment: { ...deployment, status: "started", startedAt: new Date().toISOString(), retryReason: flags.reason ?? null } };
  writeSession(cwd, { ...readSession(cwd), deployment: session.deployment });
  assertActive(cwd, readSession(cwd));
  const result = runShell(config.cmd, options);
  if (!result.ok) {
    writeSession(cwd, { ...readSession(cwd), deployment: { ...session.deployment, status: "failed" } });
    throw refused("Deployment did not complete successfully.", { agent: "Inspect the deployment provider, fix the cause, and resume with deploy. Do not report the task complete.", data: { status: result.status, timedOut: result.timedOut } });
  }
  writeSession(cwd, { ...readSession(cwd), deployment: { ...session.deployment, status: "verifying" } });
  assertActive(cwd, readSession(cwd));
  if (!runShell(config.verifyCmd, options).ok) throw refused("Deployment ran, but the expected revision and smoke checks are not verified.", { agent: "Investigate the live result and rerun deploy to verify the same revision. It will not redeploy without --retry and a reason." });
  return finish(cwd, readSession(cwd));
}
function finish(cwd, session) {
  session = readSession(cwd);
  assertActive(cwd, session);
  assertDeliveryNotWithdrawn(cwd, session.shipping?.approval);
  const updated = { ...markSynced(session), deployment: { ...session.deployment, status: "verified", verifiedAt: new Date().toISOString() } };
  writeSession(cwd, updated);
  return ok({ operator: `Delivered and verified in ${session.deployment.config.environment}.`, agent: "The task is complete.", data: { commit: session.savedCommit, environment: session.deployment.config.environment, status: updated.status } });
}
