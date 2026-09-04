import { isNonTechnical, loadConfig } from "../lib/config.mjs";
import { runShell } from "../lib/exec.mjs";
import { failed, ok, refused } from "../lib/output.mjs";
import { stateDir } from "../lib/git.mjs";
import { captureScreenshots, shouldCapture } from "../lib/screenshots.mjs";
import { CLI, markAwaitingFeedback, requireBrief, requireOpenSession, sessionConcernFiles, writeSession } from "../lib/session.mjs";
import { join } from "node:path";

export const description = "Present the working result to the operator and read the acceptance checks back.";
export const usage = "preview [--json]";

export default async function run({ cwd }) {
  const config = loadConfig(cwd);
  const session = requireOpenSession(cwd);
  const brief = requireBrief(session);
  const preview = config.preview ?? { kind: "manual" };
  const where = await confirmPreview(preview, config, cwd);
  const files = sessionConcernFiles(session, cwd);
  const updated = markAwaitingFeedback(session, files);
  writeSession(cwd, updated);
  const shots = preview.kind === "web" && shouldCapture(config)
    ? captureScreenshots(cwd, { url: preview.url, paths: preview.screenshotPaths ?? ["/"], outDir: join(stateDir(cwd), "preview", `round-${updated.reviewRound}`) })
    : { skipped: true, files: [] };

  const checks = brief.acceptance.map((item, index) => `${index + 1}. ${item}`).join("\n");
  const operator = [
    `The working result is ready to review${where.operator ? ` ${where.operator}` : ""}.`,
    "Please check:",
    checks,
    brief.nonGoals.length ? `Left alone on purpose: ${brief.nonGoals.join("; ")}.` : "",
    "Tell me what to change, or say it looks good.",
  ].filter(Boolean).join("\n");

  return ok({
    operator,
    agent: [
      `Round ${updated.reviewRound}. Stop now and wait for the operator's feedback. Do not write tests or start final checks.`,
      `Change requests: run ${CLI} revise, update, then preview again.`,
      `Clear acceptance: STAFF_ENGINEER_PREVIEW_APPROVED=1 ${CLI} finalize`,
      where.agent ?? "",
      shots.files.length ? `Screenshots (look at them before presenting; share them when the harness allows):\n${shots.files.map((file) => `- ${file}`).join("\n")}` : "",
      shots.skipped === false && !shots.ok ? `Screenshots failed (preview still presented): ${shots.reason}` : "",
      isNonTechnical(config) ? "Keep the message free of file names, commands, and tool output." : "",
    ].filter(Boolean).join("\n"),
    data: { round: updated.reviewRound, files, preview: where, brief, screenshots: shots.files },
  });
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
