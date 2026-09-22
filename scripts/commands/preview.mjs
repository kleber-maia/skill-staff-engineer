import { isNonTechnical, loadConfig } from "../lib/config.mjs";
import { runShell } from "../lib/exec.mjs";
import { failed, ok, refused } from "../lib/output.mjs";
import { stateDir } from "../lib/git.mjs";
import { captureScreenshots, shouldCapture } from "../lib/screenshots.mjs";
import { runProbes, screenshotChanges, selfCheckPlan } from "../lib/self-check.mjs";
import { getSetting } from "../lib/settings.mjs";
import { laneOf, laneOverflow, sourceFingerprint } from "../lib/lanes.mjs";
import { CLI, markAwaitingFeedback, requireBrief, requireOpenSession, sessionConcernFiles, writeSession } from "../lib/session.mjs";
import { join } from "node:path";

export const description = "Present the working result to the operator and read the acceptance checks back.";
export const usage = "preview [--json]";

export default async function run({ cwd }) {
  const config = loadConfig(cwd);
  const session = requireOpenSession(cwd);
  const brief = requireBrief(session);
  const files = sessionConcernFiles(session, cwd);
  assertPreviewableConcern(session, files, config);
  const lane = laneOf(session);
  const overflow = laneOverflow(cwd, config, session);
  if (overflow) throw refused("This change is bigger than a quick fix, so it needs the full review steps.", { agent: overflow });
  if (session.kind === "bug" && !session.repro?.failsAtBase && !session.repro?.waiver) {
    throw refused("A bug fix is shown only after a test proves the bug.", { agent: `Write a test that reproduces it and run ${CLI} repro "<test command>" first.` });
  }
  if (lane === "large" && !session.plan) {
    throw refused("A large change needs an agreed plan before the first preview.", { agent: `Write the spec and plan (spec-and-plan skill), get agreement, then run ${CLI} plan <path>.` });
  }
  const preview = config.preview ?? { kind: "manual" };
  const where = await confirmPreview(preview, config, cwd);
  const plan = selfCheckPlan(getSetting(cwd, "preview.selfCheck"), lane);
  const probes = plan.probes && brief.checks?.length ? await runProbes(cwd, config, session) : null;
  const selfCheck = probes ? { fingerprint: probes.fingerprint, results: probes.results } : session.selfCheck;
  if (probes?.failures.length) {
    writeSession(cwd, { ...session, selfCheck, probeFailures: (session.probeFailures ?? 0) + 1 });
    throw refused("The result did not pass the toolkit's own checks yet, so it is not ready to show.", {
      errors: probes.failures.map((failure) => `Acceptance check ${brief.checks[failure.index].accept + 1}: ${failure.detail}`),
      agent: "Fix what these checks found, then run preview again. Only the failing behavior needs attention.",
    });
  }
  const combined = lane === "trivial";
  const updated = markAwaitingFeedback({ ...session, selfCheck }, files, { presentedSource: combined ? sourceFingerprint(cwd, config, session) : undefined });
  const shots = preview.kind === "web" && shouldCapture(config)
    ? captureScreenshots(cwd, { url: preview.url, paths: preview.screenshotPaths ?? ["/"], outDir: join(stateDir(cwd), "preview", `round-${updated.reviewRound}`) })
    : { skipped: true, files: [] };
  const shotChanges = screenshotChanges(shots.files ?? [], session.screenshots);
  writeSession(cwd, shots.files?.length ? { ...updated, screenshots: shotChanges.hashes } : updated);

  const checks = brief.acceptance.map((item, index) => `${index + 1}. ${item}`).join("\n");
  const operator = [
    `The working result is ready to review${where.operator ? ` ${where.operator}` : ""}.`,
    "Please check:",
    checks,
    brief.nonGoals.length ? `Left alone on purpose: ${brief.nonGoals.join("; ")}.` : "",
    combined ? "If it is right, say \"ship it\" and I will run the checks and save it as it is. Otherwise tell me what to change." : "Tell me what to change, or say it looks good.",
  ].filter(Boolean).join("\n");

  return ok({
    operator,
    agent: [
      `Round ${updated.reviewRound}. Stop now and wait for the operator's feedback. Do not continue editing while feedback is open.`,
      `Change requests: run ${CLI} revise, update, then preview again.`,
      `Clear acceptance: ${CLI} finalize --approval-quote "<the operator's exact words>"`,
      combined ? "Trivial lane: that acceptance also approves the save, as long as the source stays byte-identical. Tests and docs should already be done." : "",
      where.agent ?? "",
      probes ? `Self-check: ${probes.cached ? "unchanged since the last passing run" : `${probes.results.length} automatic check${probes.results.length === 1 ? "" : "s"} passed`}.` : "",
      plan.screenshots && shotChanges.changed.length ? `Look at these changed screenshots before presenting:\n${shotChanges.changed.map((file) => `- ${file}`).join("\n")}` : "",
      shots.files.length ? `Screenshots to share when the harness allows:\n${shots.files.map((file) => `- ${file}`).join("\n")}` : "",
      shots.skipped === false && !shots.ok ? `Screenshots failed (preview still presented): ${shots.reason}` : "",
      isNonTechnical(config) ? "Keep the message free of file names, commands, and tool output." : "",
    ].filter(Boolean).join("\n"),
    data: { round: updated.reviewRound, lane, combinedApproval: combined, files, preview: where, brief, screenshots: shots.files },
  });
}

export function assertPreviewableConcern(session, files, config) {
  if (!files.length) {
    throw refused("There is no working result to present yet.", {
      agent: "Make the first reviewable change, then run preview again.",
    });
  }
}

async function confirmPreview(preview, config, cwd) {
  if (preview.kind === "web") {
    const reachable = await isReachable(preview.url);
    if (!reachable) {
      throw refused("The preview is not running, so there is nothing to show yet.", {
        agent: `Start it in the background with: ${preview.cmd ?? "<the project's start command>"}  then wait for ${preview.url} to respond and run preview again. Do not present a localhost address to a non-technical operator; configure operator.previewPublicUrl if the operator needs a different address.`,
      });
    }
    const shown = config.operator?.previewPublicUrl ?? preview.url;
    return { kind: "web", url: shown, operator: `at ${shown}`, agent: `Preview verified at ${preview.url}.` };
  }
  if (preview.kind === "command") {
    const result = runShell(preview.cmd, { cwd, timeoutMs: preview.timeoutMs ?? 120000 });
    if (!result.ok) {
      throw failed("The preview command did not finish successfully, so there is nothing to show yet.", {
        agent: `Command: ${preview.cmd}\n${tail(result.stderr || result.stdout)}`,
        data: { command: preview.cmd, status: result.status, timedOut: result.timedOut },
      });
    }
    return { kind: "command", output: tail(result.stdout, 60), operator: "", agent: `Preview command output (share the relevant part in plain language):\n${tail(result.stdout, 40)}` };
  }
  return { kind: "manual", operator: preview.instructions ? `(${preview.instructions})` : "", agent: "Manual preview: describe exactly how the operator can see or try the result." };
}

async function isReachable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
    clearTimeout(timer);
    return response.status > 0 && response.status < 500;
  } catch {
    return false;
  }
}

function tail(text, lines = 30) {
  return (text ?? "").trim().split(/\r?\n/).slice(-lines).join("\n");
}
