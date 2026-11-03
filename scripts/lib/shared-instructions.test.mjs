import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { updateToolkit } from "../commands/update.mjs";
import { defaultConfig } from "../lib/config.mjs";
import { head } from "../lib/git.mjs";
import { checkedCodeTreeMatches, codeTreeFingerprint, RECEIPT_VERSION, receiptMatches } from "../lib/receipt.mjs";

function fixture(t, target = "AGENTS.md") {
  const root = mkdtempSync(join(tmpdir(), "staff-engineer-shared-instructions-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  mkdirSync(join(root, ".staff-engineer"));
  writeFileSync(join(root, ".staff-engineer/config.json"), JSON.stringify(defaultConfig()));
  writeFileSync(join(root, "AGENTS.md"), "# Project instructions\nKeep this guidance.\n");
  writeFileSync(join(root, "unrelated.txt"), "Keep this pending work.\n");
  symlinkSync(target, join(root, "CLAUDE.md"));
  // Exercise the real updater transaction with a minimal child installer. The
  // fixture updates the managed file and deliberately leaves CLAUDE.md alone.
  const source = join(root, "installer-source");
  mkdirSync(join(source, "scripts"), { recursive: true });
  writeFileSync(join(source, "scripts/cli.mjs"), `
    import { appendFileSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    const root = process.argv[process.argv.indexOf("--target") + 1];
    appendFileSync(join(root, "AGENTS.md"), "Updated toolkit instructions.\\n");
    writeFileSync(join(root, ".staff-engineer/install.json"), JSON.stringify({ version: "0.9.0", created: [] }));
    console.log(JSON.stringify({ ok: true, data: { version: "0.9.0", changed: [{ path: "AGENTS.md" }] } }));
  `);
  return { root, source };
}

test("an update preserves CLAUDE.md linked to AGENTS.md and unrelated project work", async (t) => {
  const { root, source } = fixture(t);
  const result = await updateToolkit({ cwd: root, services: { updateSource: source } });
  assert.equal(result.ok, true);
  assert.equal(result.data.updated, true);
  assert.equal(readlinkSync(join(root, "CLAUDE.md")), "AGENTS.md");
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /Keep this guidance\./);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), readFileSync(join(root, "AGENTS.md"), "utf8"));
  assert.equal(readFileSync(join(root, "unrelated.txt"), "utf8"), "Keep this pending work.\n");
});

test("an update still rejects an instructions link to another destination", async (t) => {
  const external = mkdtempSync(join(tmpdir(), "staff-engineer-external-test-"));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  const target = join(external, "instructions.md");
  writeFileSync(target, "Outside instructions stay untouched.\n");
  const { root, source } = fixture(t, target);
  await assert.rejects(updateToolkit({ cwd: root, services: { updateSource: source } }), /symbolic link: CLAUDE\.md/);
  assert.equal(readFileSync(target, "utf8"), "Outside instructions stay untouched.\n");
  assert.equal(readlinkSync(join(root, "CLAUDE.md")), target);
});

test("saving accepts the checked staged batch while protecting unrelated pending edits", (t) => {
  const { root } = fixture(t);
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  writeFileSync(join(root, "app.swift"), "original app\n");
  writeFileSync(join(root, "pending.swift"), "original pending\n");
  git("add", "app.swift", "pending.swift");
  git("-c", "user.name=Toolkit Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "Create fixture");
  writeFileSync(join(root, "app.swift"), "approved app\n");
  writeFileSync(join(root, "pending.swift"), "unrelated pending work\n");
  git("add", "app.swift");
  const config = defaultConfig();
  const checked = codeTreeFingerprint(root, config, "working");
  const receipt = { version: RECEIPT_VERSION, status: "passed", headCommit: head(root), codeTree: checked.digest };
  assert.equal(receiptMatches(receipt, root, config, "staged"), true);
  assert.equal(checkedCodeTreeMatches(root, config, checked.digest, "staged"), true);

  writeFileSync(join(root, "pending.swift"), "changed after verification\n");
  assert.equal(receiptMatches(receipt, root, config, "staged"), false);
  assert.equal(checkedCodeTreeMatches(root, config, checked.digest, "staged"), false);
  writeFileSync(join(root, "pending.swift"), "unrelated pending work\n");
  assert.equal(receiptMatches(receipt, root, config, "staged"), true);

  writeFileSync(join(root, "app.swift"), "untested staged content\n");
  git("add", "app.swift");
  writeFileSync(join(root, "app.swift"), "approved app\n");
  assert.equal(receiptMatches(receipt, root, config, "staged"), false);
  assert.equal(checkedCodeTreeMatches(root, config, checked.digest, "staged"), false);
});
