// A verification receipt fingerprints the batch that the full check exercised.
// Prose edits afterwards do not invalidate it; executable, rule, dependency, and
// configuration edits do, including vendored toolkit runtime/configuration files.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { dirtyFiles, head, stagedEntry, stagedFiles, stateDir, workingTreeEntry } from "./git.mjs";
import { readJson, writeJson } from "./fs-safe.mjs";
import { documentationFiles, isPlainDocumentationFile, verificationFiles } from "./documentation.mjs";

export const RECEIPT_VERSION = 3;

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
  const files = verificationFiles(cwd, mode).filter(file => !isPlainDocumentationFile(cwd, config, file));
  return batchFingerprint(cwd, mode, files);
}

export function receiptMatches(receipt, cwd, config, mode = "staged") {
  if (!receipt || receipt.version !== RECEIPT_VERSION || receipt.status !== "passed") return false;
  if (receipt.headCommit !== head(cwd)) return false;
  if (receipt.scope === "documentation") {
    const files = documentationFiles(cwd, config);
    if (!files || batchFingerprint(cwd, "working", files).digest !== receipt.documentationTree) return false;
    const selected = mode === "staged" ? stagedFiles(cwd) : files;
    if (batchFingerprint(cwd, mode, selected).digest !== batchFingerprint(cwd, "working", selected).digest) return false;
  }
  return checkedCodeTreeMatches(cwd, config, receipt.codeTree, mode);
}

// A receipt covers the full working context and the exact bytes staged to save.
export function checkedCodeTreeMatches(cwd, config, checkedDigest, mode = "staged") {
  if (codeTreeFingerprint(cwd, config, "working").digest !== checkedDigest) return false;
  const batch = codeTreeFingerprint(cwd, config, mode);
  return batch.digest === batchFingerprint(cwd, "working", batch.files).digest;
}
