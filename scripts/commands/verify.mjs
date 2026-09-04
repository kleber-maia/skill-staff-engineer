// Quiet verification wrapper around the project's configured gates.
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { gateStatus, loadConfig } from "../lib/config.mjs";
import { runShell } from "../lib/exec.mjs";
import { ensureDir, readJson, timestamp, writeJson } from "../lib/fs-safe.mjs";
import { head, stateDir } from "../lib/git.mjs";
import { failed, ok, refused, tooling } from "../lib/output.mjs";
import { classify } from "../lib/paths.mjs";
import { codeTreeFingerprint, RECEIPT_VERSION, writeReceipt } from "../lib/receipt.mjs";
import { assertMayRunChecks, CLI, readSession, sessionConcernFiles } from "../lib/session.mjs";
import { estimateSentence, recordTimings, slownessWarnings, typicalDurations } from "../lib/timings.mjs";

export const description = "Run the configured checks. fast: format, lint, typecheck, tests. full: plus build and end-to-end; writes the receipt.";
export const usage = "verify --mode fast|full";

const MODES = {
  fast: { gates: ["format", "lint", "typecheck", "test"], timeoutMs: 15 * 60 * 1000 },
  full: { gates: ["format", "lint", "typecheck", "test", "build", "e2e"], timeoutMs: 45 * 60 * 1000 },
};
const KEEP_LOGS = 20;

export default async function run({ cwd, flags, env = process.env }) {
  const mode = flags.mode ?? "fast";
  if (!MODES[mode]) throw refused(`Unknown mode "${mode}". Use --mode fast or --mode full.`);
  const config = loadConfig(cwd);
  const session = readSession(cwd);
  const active = session && !session.cleared && session.status === "open" ? session : null;
  if (active) assertMayRunChecks(active, config, cwd);

  const unknown = MODES[mode].gates.filter((name) => gateStatus(config, name) === "unknown");
  if (unknown.length) {
    throw tooling(`Some checks are not configured yet: ${unknown.join(", ")}.`, {
      agent: `Run ${CLI} doctor, ask the operator the listed questions, and record answers with ${CLI} config set gates.<name>.cmd "..." (or null when not applicable).`,
    });
  }

  const verifyDir = ensureDir(join(stateDir(cwd), "verify"));
  const release = acquireLock(verifyDir);
  try {
    const startedAt = Date.now();
    const concernFiles = active ? sessionConcernFiles(active, cwd) : [];
    const results = [];
    for (const name of MODES[mode].gates) {
      const gate = config.gates[name];
      if (gate === null) {
        results.push({ name, status: "skipped", reason: "not applicable", durationMs: 0 });
        continue;
      }
      const command = chooseCommand(name, gate, mode, concernFiles, config);
      const result = runShell(command, { cwd, env, timeoutMs: gate.timeoutMs ?? MODES[mode].timeoutMs });
      results.push({ name, status: result.ok ? "passed" : "failed", command, durationMs: result.durationMs, timedOut: result.timedOut, exitStatus: result.status, stdout: result.stdout, stderr: result.stderr });
      if (!result.ok) break; // stop at the first failure; the report focuses on it
    }
    const durationMs = Date.now() - startedAt;
    const typical = typicalDurations(cwd);
    recordTimings(cwd, mode, results, durationMs);
    const slow = slownessWarnings(results, typical);
    const logPath = writeLog(verifyDir, mode, results);
    pruneLogs(verifyDir);
    const failure = results.find((entry) => entry.status === "failed");
    const summary = results.map(({ name, status, durationMs: ms, reason }) => `${name}: ${status}${reason ? ` (${reason})` : ""}${ms ? ` ${formatDuration(ms)}` : ""}`).join("\n");

    if (failure) {
      const report = failureReport(failure);
      writeJson(join(verifyDir, `latest-${mode}.json`), { version: RECEIPT_VERSION, mode, status: "failed", at: new Date().toISOString(), headCommit: head(cwd), gates: strip(results), log: logPath });
      throw failed(`The ${failure.name} check failed.`, {
        errors: [report.headline, ...report.locations.map((loc) => `  ${loc}`)],
        agent: [`Command: ${failure.command}`, report.excerpt, `Full log: ${logPath}`, "Fix the cause, then rerun verify. Do not add retries or weaken the check."].join("\n"),
        data: { mode, results: strip(results), report, log: logPath },
      });
    }

    const fingerprint = codeTreeFingerprint(cwd, config, "working");
    const receipt = { version: RECEIPT_VERSION, mode, status: "passed", at: new Date().toISOString(), headCommit: head(cwd), codeTree: fingerprint.digest, codeFiles: fingerprint.files, gates: strip(results), durationMs, log: logPath, slow };
    writeReceipt(cwd, receipt);
    const ran = results.filter((entry) => entry.status === "passed").length;
    return ok({
      operator: `All checks passed (${ran} check${ran === 1 ? "" : "s"}, ${formatDuration(durationMs)}).`,
      agent: [summary, ...slow.map((warning) => `Slower than usual: ${warning}`), estimateSentence(typical, mode) ?? "", mode === "full" ? "Receipt written; docs edits keep it valid, code edits require one more full check." : "Fast check only; run --mode full once on the final staged batch."].filter(Boolean).join("\n"),
      data: receipt,
    });
  } finally {
    release();
  }
}

function chooseCommand(name, gate, mode, concernFiles, config) {
  if (name === "test" && mode === "fast" && gate.affected && concernFiles.length) {
    const relevant = concernFiles.filter((file) => ["source", "tests"].includes(classify(config, file)) && existsSync(file));
    if (relevant.length) return gate.affected.replace("{files}", relevant.map(quote).join(" "));
  }
  return gate.cmd;
}

function quote(file) {
  return /[\s"'$]/.test(file) ? JSON.stringify(file) : file;
}

// One verification at a time per repository.
function acquireLock(dir) {
  const lockPath = join(dir, ".lock");
  if (existsSync(lockPath)) {
    const lock = readJson(lockPath, {});
    const alive = lock.pid && isAlive(lock.pid);
    const fresh = lock.at && Date.now() - Date.parse(lock.at) < 60 * 60 * 1000;
    if (alive && fresh) {
      throw refused("Another verification is already running for this project.", { agent: `Wait for it to finish (pid ${lock.pid}) instead of starting a second run.` });
    }
  }
  writeJson(lockPath, { pid: process.pid, at: new Date().toISOString() });
  return () => rmSync(lockPath, { force: true });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeLog(dir, mode, results) {
  const path = join(dir, `${timestamp()}--${mode}.log`);
  const body = results.map((entry) => [`### ${entry.name}: ${entry.status}${entry.command ? `\n$ ${entry.command}` : ""}`, entry.stdout ?? "", entry.stderr ?? ""].join("\n")).join("\n\n");
  writeFileSync(path, body, "utf8");
  return path;
}

function pruneLogs(dir) {
  const logs = readdirSync(dir).filter((name) => name.endsWith(".log")).sort();
  for (const name of logs.slice(0, Math.max(0, logs.length - KEEP_LOGS))) rmSync(join(dir, name), { force: true });
}

function strip(results) {
  return results.map(({ stdout, stderr, ...rest }) => rest);
}

export function failureReport(failure) {
  const text = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
  const locationPattern = /(?:^|[\s(])((?:[\w.-]+\/)*[\w.-]+\.[a-z]{1,5}):(\d+)(?::(\d+))?/gm;
  const locations = [...new Set([...text.matchAll(locationPattern)].map((match) => `${match[1]}:${match[2]}`))]
    .filter((loc) => !/node_modules|site-packages/.test(loc))
    .slice(0, 20);
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const failing = lines.filter((line) => /fail|error|assert|expected|panic|exception|traceback/i.test(line)).slice(0, 12);
  return {
    headline: failure.timedOut ? `Timed out after ${formatDuration(failure.durationMs)}.` : failing[0] ?? lines.at(-1) ?? `Exit status ${failure.exitStatus}.`,
    locations,
    excerpt: (failing.length ? failing : lines.slice(-25)).join("\n"),
  };
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
