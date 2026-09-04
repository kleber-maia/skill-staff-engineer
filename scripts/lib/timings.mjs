// Verification timing ledger: how long each gate usually takes, and warnings when
// a run is noticeably slower than usual.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ensureDir } from "./fs-safe.mjs";
import { stateDir } from "./git.mjs";

export const RETENTION = 200;
export const SLOWDOWN_RATIO = 1.2;
export const MIN_WARN_MS = 10_000;

export function ledgerPath(cwd) {
  return join(ensureDir(join(stateDir(cwd), "verify")), "timings.jsonl");
}

export function recordTimings(cwd, mode, results, totalMs, { now = new Date().toISOString() } = {}) {
  const path = ledgerPath(cwd);
  const entries = results
    .filter((result) => result.status === "passed" || result.status === "failed")
    .map((result) => ({ at: now, mode, gate: result.name, status: result.status, durationMs: result.durationMs }));
  entries.push({ at: now, mode, gate: "*", status: results.some((result) => result.status === "failed") ? "failed" : "passed", durationMs: totalMs });
  const existing = readLedger(cwd);
  const all = [...existing, ...entries].slice(-RETENTION);
  writeFileSync(path, `${all.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  return entries;
}

export function readLedger(cwd) {
  const path = ledgerPath(cwd);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Median duration per gate (passed runs only) and per mode total.
export function typicalDurations(cwd) {
  const ledger = readLedger(cwd).filter((entry) => entry.status === "passed");
  const byGate = groupMedian(ledger.filter((entry) => entry.gate !== "*"), (entry) => entry.gate);
  const byMode = groupMedian(ledger.filter((entry) => entry.gate === "*"), (entry) => entry.mode);
  return { byGate, byMode, samples: ledger.length };
}

export function slownessWarnings(results, typical, { ratio = SLOWDOWN_RATIO, minMs = MIN_WARN_MS } = {}) {
  const warnings = [];
  for (const result of results) {
    if (result.status !== "passed") continue;
    const usual = typical.byGate[result.name];
    if (usual && result.durationMs > minMs && result.durationMs > usual * ratio) {
      warnings.push(`${result.name} took ${formatDuration(result.durationMs)}, usually ${formatDuration(usual)}. Look for what got slower while you are in this change.`);
    }
  }
  return warnings;
}

export function estimateSentence(typical, mode = "full") {
  const usual = typical.byMode[mode];
  if (!usual) return null;
  return `The ${mode} check usually takes about ${formatDuration(usual)}.`;
}

export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function groupMedian(entries, keyOf) {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry.durationMs);
  }
  const out = {};
  for (const [key, values] of groups) out[key] = median(values);
  return out;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function appendRaw(cwd, entry) {
  appendFileSync(ledgerPath(cwd), `${JSON.stringify(entry)}\n`, "utf8");
}
