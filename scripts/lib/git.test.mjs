import { test } from "node:test";
import assert from "node:assert/strict";

import { parseUnifiedDiff } from "./diff.mjs";
import { dirtyFiles, stagedDiff, stagedFiles, stagedNumstat } from "./git.mjs";
import { defaultConfig } from "./config.mjs";
import { codeTreeFingerprint, receiptMatches, RECEIPT_VERSION } from "./receipt.mjs";
import { cleanup, git, makeTempRepo, writeFiles } from "./test-helpers.mjs";

test("git paths with spaces and Unicode remain exact in status, diffs, and receipts", () => {
  const original = "src/café old name.mjs";
  const renamed = "src/naïve new name.mjs";
  const dir = makeTempRepo({ files: { [original]: "export const value = 1;\nexport const keep = 2;\nexport const stable = 3;\n" } });
  const config = defaultConfig();
  try {
    git(dir, "mv", original, renamed);
    writeFiles(dir, { [renamed]: "export const value = 2;\nexport const keep = 2;\nexport const stable = 3;\n" });
    git(dir, "add", "--", renamed);
    assert.deepEqual(stagedFiles(dir), [renamed]);
    assert.deepEqual(dirtyFiles(dir), [renamed]);
    assert.equal(stagedNumstat(dir)[0].file, renamed);
    const parsed = parseUnifiedDiff(stagedDiff(dir), stagedFiles(dir));
    assert.equal(parsed[0].file, renamed);
    assert.equal(parsed[0].status, "R");

    const fingerprint = codeTreeFingerprint(dir, config, "staged");
    const receipt = { version: RECEIPT_VERSION, status: "passed", headCommit: git(dir, "rev-parse", "HEAD"), codeTree: fingerprint.digest };
    assert.deepEqual(fingerprint.files, [renamed]);
    assert.equal(receiptMatches(receipt, dir, config, "staged"), true);

    writeFiles(dir, { [renamed]: "export const value = 'broken';\n" });
    git(dir, "add", "--", renamed);
    assert.equal(receiptMatches(receipt, dir, config, "staged"), false);
  } finally {
    cleanup(dir);
  }
});

test("NUL-delimited git helpers preserve tabs and newlines in file names", { skip: process.platform === "win32" }, () => {
  const tabbed = "src/tab\tname.mjs";
  const newline = "src/line\nname.mjs";
  const dir = makeTempRepo({ files: { [tabbed]: "one\n", [newline]: "one\n" } });
  try {
    writeFiles(dir, { [tabbed]: "two\n", [newline]: "two\n" });
    git(dir, "add", "--", tabbed, newline);
    assert.deepEqual(stagedFiles(dir).sort(), [newline, tabbed].sort());
    assert.deepEqual(stagedNumstat(dir).map(({ file }) => file).sort(), [newline, tabbed].sort());
    assert.deepEqual(parseUnifiedDiff(stagedDiff(dir), stagedFiles(dir)).map(({ file }) => file).sort(), [newline, tabbed].sort());
  } finally {
    cleanup(dir);
  }
});

test("staged blob hashes treat glob-looking file names as literal paths", () => {
  const literal = "src/[0].js";
  const sibling = "src/0.js";
  const dir = makeTempRepo({ files: { [literal]: "base\n", [sibling]: "zero\n" } });
  const config = defaultConfig();
  try {
    writeFiles(dir, { [literal]: "zero\n" });
    git(dir, "add", "--", literal);
    const fingerprint = codeTreeFingerprint(dir, config, "staged");
    const receipt = { version: RECEIPT_VERSION, status: "passed", headCommit: git(dir, "rev-parse", "HEAD"), codeTree: fingerprint.digest };
    assert.deepEqual(fingerprint.files, [literal]);
    assert.equal(receiptMatches(receipt, dir, config, "staged"), true);

    writeFiles(dir, { [literal]: "BROKEN\n" });
    git(dir, "add", "--", literal);
    assert.equal(receiptMatches(receipt, dir, config, "staged"), false);
  } finally {
    cleanup(dir);
  }
});
