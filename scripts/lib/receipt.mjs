// A verification receipt fingerprints the batch that the full check exercised.
// Prose edits afterwards do not invalidate it; executable, rule, dependency, and
// configuration edits do, including vendored toolkit runtime/configuration files.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { dirtyFiles, head, stagedBlobHash, stagedFiles, stateDir, workingTreeHash } from "./git.mjs";
import { readJson, writeJson } from "./fs-safe.mjs";
import { isVerificationDocumentation } from "./paths.mjs";

export const RECEIPT_VERSION = 1;

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
export function codeTreeFingerprint(cwd, config, mode = "working") {
  const files = (mode === "staged" ? stagedFiles(cwd) : dirtyFiles(cwd)).filter((file) => countsForReceipt(config, file));
  const entries = [];
  for (const file of files.sort()) {
    const hash = (mode === "staged" ? stagedBlobHash(file, cwd) : workingTreeHash(file, cwd)) || "deleted";
    entries.push([file, hash]);
  }
  return { files: entries.map(([file]) => file), digest: createHash("sha256").update(JSON.stringify(entries)).digest("hex") };
}

export function receiptMatches(receipt, cwd, config, mode = "staged") {
  if (!receipt || receipt.version !== RECEIPT_VERSION || receipt.status !== "passed") return false;
  if (receipt.headCommit !== head(cwd)) return false;
  return codeTreeFingerprint(cwd, config, mode).digest === receipt.codeTree;
}
