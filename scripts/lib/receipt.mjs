// A verification receipt fingerprints the code that the full check exercised.
// Docs and toolkit edits afterwards do not invalidate it; code edits do.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { dirtyFiles, head, stagedBlobHash, stagedFiles, stateDir, workingTreeHash } from "./git.mjs";
import { readJson, writeJson } from "./fs-safe.mjs";
import { classify } from "./paths.mjs";

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
  const kind = classify(config, file);
  return kind !== "docs" && kind !== "toolkit";
}

// "working": fingerprint dirty code files as they are on disk (verification time).
// "staged": fingerprint staged code files from the index (ship time).
export function codeTreeFingerprint(cwd, config, mode = "working") {
  const files = (mode === "staged" ? stagedFiles(cwd) : dirtyFiles(cwd)).filter((file) => countsForReceipt(config, file));
  const entries = [];
  for (const file of files.sort()) {
    const hash = mode === "staged" ? stagedBlobHash(file, cwd) : workingTreeHash(file, cwd);
    if (!hash || hash === "deleted") continue;
    entries.push(`${file} ${hash}`);
  }
  return { files: entries.map((entry) => entry.split(" ")[0]), digest: createHash("sha256").update(entries.join("\n")).digest("hex") };
}

export function receiptMatches(receipt, cwd, config, mode = "staged") {
  if (!receipt || receipt.version !== RECEIPT_VERSION || receipt.status !== "passed") return false;
  if (receipt.headCommit !== head(cwd)) return false;
  return codeTreeFingerprint(cwd, config, mode).digest === receipt.codeTree;
}
