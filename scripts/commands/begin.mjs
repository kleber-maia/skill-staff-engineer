import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadConfig, TOOLKIT_DIR } from "../lib/config.mjs";
import { baselineUnchanged } from "../lib/baseline.mjs";
import { relevantDecisions, renderDecisions } from "../lib/decisions.mjs";
import { agentInsights, renderAgentInsights } from "../lib/insights.mjs";
import { output } from "../lib/exec.mjs";
import { readJson, writeJson } from "../lib/fs-safe.mjs";
import { dirtyFiles, head, stateDir } from "../lib/git.mjs";
import { assertLane, DEFAULT_LANE } from "../lib/lanes.mjs";
import { nextStep, renderNext } from "../lib/next.mjs";
import { ok, refused, ToolkitError, tooling } from "../lib/output.mjs";
import { assertCanBegin, beginSession, readSession } from "../lib/session.mjs";
import { getSetting } from "../lib/settings.mjs";
import { updateToolkit, updateTransactionTargets } from "./update.mjs";

export const description = "Open exactly one work session for one concern.";
export const usage = 'begin "<short concern>" [--lane trivial|standard|large]';

// Set only for the refreshed CLI that begin re-runs right after an upgrade.
const UPDATED_ENV = "STAFF_ENGINEER_UPDATE_CHECKED";

export default async function run({ cwd, positional, flags = {}, env = process.env, services = {} }) {
  const lane = assertLane(flags.lane ?? DEFAULT_LANE);
  // An already-open concern is not a workflow start. Refuse it before consulting
  // upstream so an update can never land in the middle of active work.
  const existing = readSession(cwd);
  assertCanBegin(existing, head(cwd), existing ? baselineUnchanged(existing.baseline, cwd) : true);

  if (env[UPDATED_ENV] !== "1" && updateCheckDue(cwd)) {
    const pendingToolkit = toolkitFiles(cwd);
    let update;
    try {
      update = await (services.updateToolkit ?? updateToolkit)({ cwd, flags: {}, services });
    } catch (error) {
      throw beginPreflightError(error);
    }
    if (!update.data.offline) writeJson(checkPath(cwd), { version: 1, checkedAt: new Date().toISOString(), toolkitVersion: update.data.version ?? null });
    if (update.data.updated) {
      const upgrade = pendingToolkit.length ? null : saveUpgrade(cwd, update.data);
      if (!upgrade) {
        throw refused(`The staff-engineer toolkit updated to version ${update.data.version} before this concern started.`, {
          agent: `No work session was opened. Toolkit files had unsaved edits (${pendingToolkit.join(", ") || "the upgrade could not be saved"}), so the upgrade was not saved automatically. Save the upgrade as its own change, then run begin again.`,
          data: { update: update.data, sessionOpened: false, restartRequired: true },
        });
      }
      return beginWithRefreshedToolkit(cwd, positional, lane, upgrade);
    }
  }

  const config = loadConfig(cwd);
  const session = beginSession(cwd, positional.join(" "), { lane });
  const decisions = relevantDecisions(cwd, { text: session.concern });
  const insights = agentInsights(cwd, { webPreview: config.preview?.kind === "web", selfCheck: getSetting(cwd, "preview.selfCheck") });
  return ok({
    operator: `Started working on: ${session.concern}.`,
    agent: [
      "All changes for this concern must be staged and saved together as one batch.",
      session.baseline.files.length ? `Pre-existing pending files are protected and must stay out of this batch: ${summarize(session.baseline.files)}` : "",
      `Lane: ${lane}.`,
      decisions.length ? renderDecisions(decisions) : "",
      renderAgentInsights(insights),
      renderNext(nextStep({ cwd, config, session })),
    ].filter(Boolean).join("\n"),
    data: { ...session, decisions, insights },
  });
}

function checkPath(cwd) {
  return join(stateDir(cwd), "update-check.json");
}

export function updateCheckDue(cwd, now = Date.now()) {
  const hours = getSetting(cwd, "updates.checkEveryHours");
  if (hours === 0) return true;
  const last = Date.parse(readJson(checkPath(cwd), null)?.checkedAt ?? "");
  return !Number.isFinite(last) || now - last >= hours * 3600 * 1000;
}

function toolkitFiles(cwd) {
  const targets = updateTransactionTargets(cwd);
  return dirtyFiles(cwd).filter((file) => targets.some((target) => file === target || file.startsWith(`${target}/`)));
}

// Save the upgrade as its own commit, touching only toolkit-owned paths that
// were clean before it. Returns null when it cannot, so begin can stop instead.
function saveUpgrade(cwd, update) {
  const files = toolkitFiles(cwd);
  if (!files.length) return { version: update.version, commit: null };
  try {
    output("git", ["add", "-A", "--", ...files], { cwd });
    output("git", ["commit", "--quiet", "--only", "-m", `Upgrade the staff-engineer toolkit to ${update.version}`, "--trailer", `Toolkit-Upgrade: ${update.previousVersion} -> ${update.version}`, "--", ...files], { cwd });
    return { version: update.version, previousVersion: update.previousVersion, commit: head(cwd), files };
  } catch {
    return null;
  }
}

// The upgraded code must run the rest of the workflow, so the refreshed CLI opens the session.
function beginWithRefreshedToolkit(cwd, positional, lane, upgrade) {
  const cli = join(cwd, TOOLKIT_DIR, "cli.mjs");
  if (!existsSync(cli)) throw tooling("The upgraded toolkit is missing its command-line entry point.", { agent: "Run update again or reinstall the toolkit." });
  const result = spawnSync(process.execPath, [cli, "begin", ...positional, "--lane", lane, "--json"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, [UPDATED_ENV]: "1" },
  });
  let payload;
  try {
    payload = JSON.parse(result.stdout || result.stderr);
  } catch {
    throw tooling("The upgraded toolkit could not open the work session.", { agent: result.stderr || result.stdout, data: { toolkitUpgrade: upgrade, sessionOpened: false } });
  }
  const note = `The toolkit was upgraded to ${upgrade.version}${upgrade.commit ? ` and saved as its own change (${upgrade.commit.slice(0, 10)})` : ""}; the refreshed workflow is now running.`;
  return {
    ...payload,
    operator: payload.ok ? `I updated my working tools to version ${upgrade.version}. ${payload.operator}` : payload.operator,
    agent: [note, payload.agent].filter(Boolean).join("\n"),
    data: { ...payload.data, toolkitUpgrade: upgrade },
  };
}

function beginPreflightError(error) {
  const noSession = "No work session was opened. Resolve the update check, then restart this concern.";
  if (error instanceof ToolkitError) {
    return new ToolkitError(error.message, {
      code: error.code,
      agent: [error.agent, ...(error.agent.includes("No work session was opened") ? [] : [noSession])].filter(Boolean).join("\n"),
      errors: error.errors,
      data: { ...error.data, sessionOpened: false },
    });
  }
  return tooling("The toolkit could not complete its required update check.", { agent: noSession, data: { sessionOpened: false } });
}

function summarize(files, limit = 10) {
  return files.length <= limit ? files.join(", ") : `${files.slice(0, limit).join(", ")} and ${files.length - limit} more`;
}
