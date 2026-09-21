import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultConfig } from "./config.mjs";
import { head } from "./git.mjs";
import { codeTreeFingerprint, receiptMatches, RECEIPT_VERSION } from "./receipt.mjs";
import { cleanup, git, makeTempRepo, writeFiles } from "./test-helpers.mjs";

function passedReceipt(dir, config) {
  const fingerprint = codeTreeFingerprint(dir, config, "working");
  return {
    version: RECEIPT_VERSION,
    status: "passed",
    headCommit: head(dir),
    codeTree: fingerprint.digest,
    codeFiles: fingerprint.files,
  };
}

test("receipt stays current for an unchanged staged batch and invalidates toolkit runtime changes", () => {
  const dir = makeTempRepo({ files: {
    ".staff-engineer/config.json": "{\"version\":1}\n",
    ".staff-engineer/lib/session.mjs": "export const version = 1;\n",
    ".staff-engineer/rules/ui.json": "{}\n",
    "src/app.mjs": "export const app = true;\n",
  } });
  const config = defaultConfig();
  try {
    writeFiles(dir, { "src/app.mjs": "export const app = false;\n" });
    git(dir, "add", "src/app.mjs");
    const receipt = passedReceipt(dir, config);
    assert.equal(receiptMatches(receipt, dir, config, "staged"), true);

    writeFiles(dir, { ".staff-engineer/lib/session.mjs": "export const version = 2;\n" });
    git(dir, "add", ".staff-engineer/lib/session.mjs");
    assert.equal(receiptMatches(receipt, dir, config, "staged"), false);
  } finally {
    cleanup(dir);
  }
});

test("receipt invalidates toolkit configuration and rule changes", () => {
  const dir = makeTempRepo({ files: {
    ".staff-engineer/config.json": "{\"version\":1}\n",
    ".staff-engineer/rules/ui.json": "{}\n",
    "src/app.mjs": "export const app = true;\n",
  } });
  const config = defaultConfig();
  try {
    writeFiles(dir, { "src/app.mjs": "export const app = false;\n" });
    git(dir, "add", "src/app.mjs");
    const receipt = passedReceipt(dir, config);

    writeFiles(dir, { ".staff-engineer/config.json": "{\"version\":1,\"changed\":true}\n" });
    git(dir, "add", ".staff-engineer/config.json");
    assert.equal(receiptMatches(receipt, dir, config, "staged"), false);

    const ruleReceipt = passedReceipt(dir, config);
    writeFiles(dir, { ".staff-engineer/rules/ui.json": "{\"changed\":true}\n" });
    git(dir, "add", ".staff-engineer/rules/ui.json");
    assert.equal(receiptMatches(ruleReceipt, dir, config, "staged"), false);
  } finally {
    cleanup(dir);
  }
});

test("receipt fingerprints deletions before and after verification", () => {
  const dir = makeTempRepo({ files: {
    "src/a.mjs": "export const a = true;\n",
    "src/b.mjs": "export const b = true;\n",
  } });
  const config = defaultConfig();
  try {
    writeFiles(dir, { "src/a.mjs": "export const a = false;\n" });
    git(dir, "add", "src/a.mjs");
    const receipt = passedReceipt(dir, config);
    assert.equal(receiptMatches(receipt, dir, config, "staged"), true);

    git(dir, "rm", "src/b.mjs");
    assert.equal(receiptMatches(receipt, dir, config, "staged"), false);

    const deletionReceipt = passedReceipt(dir, config);
    assert.equal(receiptMatches(deletionReceipt, dir, config, "staged"), true);
  } finally {
    cleanup(dir);
  }
});

test("receipt counts executable and configuration files inside documentation paths", () => {
  const dir = makeTempRepo({ files: {
    "docs/config.json": "{}\n",
    "docs/example.mjs": "export const example = true;\n",
    "src/app.mjs": "export const app = true;\n",
  } });
  const config = defaultConfig();
  try {
    writeFiles(dir, { "src/app.mjs": "export const app = false;\n" });
    git(dir, "add", "src/app.mjs");
    const receipt = passedReceipt(dir, config);

    writeFiles(dir, { "docs/config.json": "{\"changed\":true}\n" });
    git(dir, "add", "docs/config.json");
    assert.equal(receiptMatches(receipt, dir, config, "staged"), false);

    const configReceipt = passedReceipt(dir, config);
    writeFiles(dir, { "docs/example.mjs": "export const example = false;\n" });
    git(dir, "add", "docs/example.mjs");
    assert.equal(receiptMatches(configReceipt, dir, config, "staged"), false);
  } finally {
    cleanup(dir);
  }
});

test("prose docs and skill guidance preserve a matching receipt", () => {
  const dir = makeTempRepo({ files: {
    "README.md": "# Demo\n",
    "AGENTS.md": "# Rules\n",
    ".agents/skills/solid/SKILL.md": "# Solid\n",
    ".agents/skills/solid/agents/openai.yaml": "description: solid\n",
    "src/app.mjs": "export const app = true;\n",
  } });
  const config = defaultConfig();
  try {
    writeFiles(dir, { "src/app.mjs": "export const app = false;\n" });
    git(dir, "add", "src/app.mjs");
    const receipt = passedReceipt(dir, config);

    writeFiles(dir, {
      "README.md": "# Demo updated\n",
      "AGENTS.md": "# Rules updated\n",
      ".agents/skills/solid/SKILL.md": "# Solid updated\n",
      ".agents/skills/solid/agents/openai.yaml": "description: updated solid\n",
    });
    git(dir, "add", "README.md", "AGENTS.md", ".agents/skills/solid/SKILL.md", ".agents/skills/solid/agents/openai.yaml");
    assert.equal(receiptMatches(receipt, dir, config, "staged"), true);

    writeFiles(dir, { ".agents/skills/solid/.staff-engineer-owned": "0.2.3\n" });
    git(dir, "add", ".agents/skills/solid/.staff-engineer-owned");
    assert.equal(receiptMatches(receipt, dir, config, "staged"), false);
  } finally {
    cleanup(dir);
  }
});
