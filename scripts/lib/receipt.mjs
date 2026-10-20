// A verification receipt fingerprints the batch that the full check exercised.
// Prose edits afterwards do not invalidate it; executable, rule, dependency, and
// configuration edits do, including vendored toolkit runtime/configuration files.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { dirtyFiles, head, stagedEntry, stagedFiles, stateDir, workingTreeEntry } from "./git.mjs";
import { readJson, writeJson } from "./fs-safe.mjs";
import { isVerificationDocumentation } from "./paths.mjs";

export const RECEIPT_VERSION = 2;

export function receiptPath(cwd, mode = "full") {
  return join(stateDir(cwd), "verify", `latest-${mode}.json`);
}

export function readReceipt(cwd, mode = "full") {
  const path = receiptPath(cwd, mode);
  return existsSync(path) ? readJson(path) : null;
}

export function writeReceipt(cwd, receipt) {
  writeJson(receiptPath(cwd, receipt.mode), receipt);
  return receipt;
}

function countsForReceipt(config, file) {
  return !isVerificationDocumentation(config, file);
}

// "working": fingerprint dirty files as they are on disk (verification time).
// "staged": fingerprint staged files from the index (ship time).
export function batchFingerprint(cwd, mode = "working", selectedFiles = null) {
  const files = selectedFiles ?? (mode === "staged" ? stagedFiles(cwd) : dirtyFiles(cwd));
  const entries = [];
  for (const file of [...files].sort()) {
    const entry = mode === "staged" ? stagedEntry(file, cwd) : workingTreeEntry(file, cwd);
    entries.push([file, entry?.mode ?? "deleted", entry?.hash ?? "deleted"]);
  }
  return { files: entries.map(([file]) => file), digest: createHash("sha256").update(JSON.stringify(entries)).digest("hex") };
}

export function codeTreeFingerprint(cwd, config, mode = "working") {
  const files = (mode === "staged" ? stagedFiles(cwd) : dirtyFiles(cwd)).filter((file) => countsForReceipt(config, file));
  return batchFingerprint(cwd, mode, files);
}

export function receiptMatches(receipt, cwd, config, mode = "staged") {
  if (!receipt || receipt.version !== RECEIPT_VERSION || receipt.status !== "passed") return false;
  if (receipt.headCommit !== head(cwd)) return false;
  return codeTreeFingerprint(cwd, config, mode).digest === receipt.codeTree;
}
