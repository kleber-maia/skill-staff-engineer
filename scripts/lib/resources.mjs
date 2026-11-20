// Only the creating harness can establish ownership or release a resource. This
// checkout-local ledger stores descriptions, never executable cleanup commands.
import { join } from "node:path";
import { readJson, writeJson } from "./fs-safe.mjs";
import { stateDir } from "./git.mjs";
import { refused } from "./output.mjs";
import { getSetting } from "./settings.mjs";

function ledgerPath(cwd) {
  return join(stateDir(cwd), "resources.json");
}

export function readResources(cwd) {
  return readJson(ledgerPath(cwd), { entries: [] });
}

export function writeResources(cwd, ledger) {
  writeJson(ledgerPath(cwd), ledger);
}

export function previewMode(cwd, session, ledger = readResources(cwd)) {
  if (ledger.override && ledger.override.task === session?.startedAt) return ledger.override.mode;
  return getSetting(cwd, "preview.mode");
}

export function resourceReport(cwd, session) {
  const ledger = readResources(cwd);
  const mode = previewMode(cwd, session, ledger);
  const current = ledger.entries.filter(entry => entry.task === session?.startedAt);
  const kept = current.filter(entry => mode === "local" && entry.preview);
  return { mode, kept, pending: current.filter(entry => !kept.includes(entry)) };
}

export const CLEANUP_GUIDANCE = 'Run resources list. Release each pending item through its original tool, verify it stopped or was removed, then record resources released <id> --proof "<observed result>".';

export function requireResourceCleanup(cwd, session) {
  const report = resourceReport(cwd, session);
  if (report.pending.length) throw refused("Task resources still need cleanup.", {
    agent: CLEANUP_GUIDANCE, data: report,
  });
  return report;
}

export function retainedNotice(kept) {
  return kept.map(entry => `Kept open for you: ${entry.name} (${entry.preview}).`).join(" ");
}
