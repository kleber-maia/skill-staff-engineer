import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { readJson } from "../lib/fs-safe.mjs";
import { loadConfig } from "../lib/config.mjs";
import { receiptMatches } from "../lib/receipt.mjs";
import { cleanup, commitAll, git, installInto, makeTempDir, makeTempRepo, runCli, writeFiles } from "../lib/test-helpers.mjs";

async function setup() {
  const dir = makeTempRepo({ files: {
    "README.md": "# Demo\n",
    "docs/guide.md": "# Guide\n",
    "src/app.mjs": "export const value = 1;\n",
  } });
  await installInto(dir);
  const config = readJson(join(dir, ".staff-engineer/config.json"));
  const appGate = { cmd: 'node -e "console.error(\'APP_GATE_RAN\'); process.exit(7)"' };
  config.gates = { install: null, format: null, lint: null, typecheck: null, test: appGate, build: appGate, e2e: null };
  writeFiles(dir, { ".staff-engineer/config.json": JSON.stringify(config, null, 2) + "\n" });
  commitAll(dir, "install toolkit");
  return dir;
}

test("pure documentation passes local checks without running app gates", async () => {
  const dir = await setup();
  try {
    writeFiles(dir, { "README.md": "# Demo\n\n[Guide](docs/guide.md)\n", "docs/new.md": "# New\n\n[Source](../src/app.mjs#L1)\n" });
    git(dir, "add", "README.md", "docs/new.md");
    const result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.data.scope, "documentation");
    assert.ok(result.json.data.gates.some(gate => gate.name === "documentation" && gate.status === "passed"));
    assert.equal(receiptMatches(result.json.data, dir, loadConfig(dir)), true);
    assert.doesNotMatch(result.stdout + result.stderr, /APP_GATE_RAN/);

    writeFiles(dir, { "docs/new.md": "# New\n\n[Broken](missing.md)\n" });
    assert.equal(receiptMatches(result.json.data, dir, loadConfig(dir)), false, "changed documentation must be rechecked");
    const broken = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(broken.code, 3);
    assert.match(broken.stderr + broken.stdout, /missing\.md/);
    assert.doesNotMatch(broken.stderr + broken.stdout, /APP_GATE_RAN/);
    assert.equal(readJson(join(dir, ".git/staff-engineer/verify/latest-full.json")).status, "failed");
  } finally { cleanup(dir); }
});

test("documentation-only receipts cannot authorize code, unstaged mixed changes or workflow instructions", async () => {
  const dir = await setup();
  try {
    writeFiles(dir, { "README.md": "# Updated\n" });
    git(dir, "add", "README.md");
    const docs = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(docs.code, 0, docs.stderr || docs.stdout);
    for (const file of ["src/app.mjs", ".staff-engineer/config.json", "AGENTS.md", "docs/security.md", ".agents/skills/solid/SKILL.md", "docs/example.mjs"]) {
      const original = readFileSync(join(dir, file === "docs/security.md" || file === "docs/example.mjs" ? "README.md" : file), "utf8");
      writeFiles(dir, { [file]: original + (file.endsWith("config.json") ? "\n" : "\nchanged\n") });
      assert.equal(receiptMatches(docs.json.data, dir, loadConfig(dir)), false, file);
      const result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
      assert.notEqual(result.code, 0, file);
      if (file !== ".staff-engineer/config.json") assert.match(result.stderr + result.stdout, /APP_GATE_RAN/, file);
      if (file.startsWith("docs/")) git(dir, "clean", "-f", "--", file);
      else git(dir, "restore", "--worktree", "--", file);
    }
  } finally { cleanup(dir); }
});

test("renaming source into documentation and executable or symbolic-link prose retain app gates", async () => {
  for (const kind of ["rename", "mode", "symlink", "dangling symlink", "binary", "clean"]) {
    const dir = await setup();
    try {
      if (kind === "rename") git(dir, "mv", "src/app.mjs", "docs/app.md");
      if (kind === "mode") {
        writeFiles(dir, { "docs/guide.md": "# Updated\n" });
        chmodSync(join(dir, "docs/guide.md"), 0o755);
      }
      if (kind === "symlink") symlinkSync("../src/app.mjs", join(dir, "docs/linked.md"));
      if (kind === "dangling symlink") symlinkSync("missing.md", join(dir, "docs/linked.md"));
      if (kind === "binary") writeFiles(dir, { "docs/binary.md": "binary\u0000data\n" });
      const result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
      assert.equal(result.code, 3, kind);
      assert.match(result.stderr + result.stdout, /APP_GATE_RAN/, kind);
    } finally { cleanup(dir); }
  }
});

test("documentation checks reject broken local links, invalid source ranges and whitespace", async () => {
  const dir = await setup();
  try {
    for (const content of ["# Guide\n\n[Missing](missing.md)\n", "# Guide\n\n[Source](../src/app.mjs#L999)\n", "# Guide  \n"]) {
      writeFiles(dir, { "docs/guide.md": content });
      const result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
      assert.equal(result.code, 3);
      assert.match(result.stderr + result.stdout, /documentation/i);
      assert.doesNotMatch(result.stderr + result.stdout, /APP_GATE_RAN/);
    }
  } finally { cleanup(dir); }
});

test("a valid documentation link handles encoded spaces, references and literal code examples", async () => {
  const dir = await setup();
  try {
    writeFiles(dir, {
      "docs/space name.md": "# Space\n",
      "docs/guide(v2).md": "# Second edition\n",
      "docs/guide.md": "# Guide\n\n[Space](space%20name.md), [Guide](guide(v2).md), [Escaped](guide\\(v2\\).md) and [source][src].\n\n[src]: ../src/app.mjs#L1\n\n```md\n[Example](missing.md)\n```\n\n`[Inline example](missing.md)`\n",
    });
    const result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    writeFiles(dir, { "docs/guide.md": "# Guide\n\n[Missing](missing(v2).md)\n" });
    const missing = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(missing.code, 3);
    assert.match(missing.stderr + missing.stdout, /missing\(v2\)\.md/);
  } finally { cleanup(dir); }
});

test("deleting a document never follows an unchanged tracked symlink for inbound checks", async () => {
  const dir = await setup(), outside = makeTempDir();
  try {
    writeFiles(outside, { "private.md": "[Do not read](guide.md)\n" });
    symlinkSync(join(outside, "private.md"), join(dir, "docs/external.md"));
    commitAll(dir, "retain an unrelated link");
    git(dir, "rm", "docs/guide.md");
    const result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
  } finally { cleanup(dir); cleanup(outside); }
});

test("explicit source or operational Markdown uses configured gates", async () => {
  for (const property of ["source", "documentable"]) {
    const dir = await setup();
    try {
      const config = loadConfig(dir);
      config.paths[property] = ["docs/guide.md"];
      writeFiles(dir, { ".staff-engineer/config.json": JSON.stringify(config, null, 2) + "\n" });
      commitAll(dir, "designate operational source");
      writeFiles(dir, { "docs/guide.md": "# Updated\n" });
      const result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
      assert.equal(result.code, 3);
      assert.match(result.stderr + result.stdout, /APP_GATE_RAN/);
    } finally { cleanup(dir); }
  }
});

test("deleting documentation checks inbound local links without requiring unrelated old links to be repaired", async () => {
  const dir = await setup();
  try {
    writeFiles(dir, { "README.md": "# Demo\n\n[Guide](docs/guide.md) and [Old](unrelated-old-link.md).\n" });
    commitAll(dir, "link the guide");
    git(dir, "rm", "docs/guide.md");
    let result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(result.code, 3);
    assert.match(result.stderr + result.stdout, /docs\/guide\.md/);
    assert.doesNotMatch(result.stderr + result.stdout, /APP_GATE_RAN/);
    writeFiles(dir, { "README.md": "# Demo\n" });
    result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
  } finally { cleanup(dir); }
});
