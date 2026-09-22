import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readJson } from "../lib/fs-safe.mjs";
import { cleanup, commitAll, installInto, makeTempRepo, runCli, writeFiles } from "../lib/test-helpers.mjs";
import { chooseCommand } from "./verify.mjs";
import { defaultConfig } from "../lib/config.mjs";

async function setup(gates) {
  const dir = makeTempRepo({ files: {
    "package.json": JSON.stringify({ name: "verify-demo", private: true }),
    "src/app.mjs": "export const value = 1;\n",
    "README.md": "# Verify demo\n",
  } });
  await installInto(dir);
  const configPath = join(dir, ".staff-engineer", "config.json");
  const config = readJson(configPath);
  config.gates = { install: null, format: null, lint: null, typecheck: null, test: null, build: null, e2e: null, ...gates };
  writeFiles(dir, { ".staff-engineer/config.json": `${JSON.stringify(config, null, 2)}\n` });
  commitAll(dir, "install toolkit");
  return dir;
}

test("affected checks receive hostile file names as data, relative to the project cwd", async () => {
  const dir = await setup({ test: { cmd: "node -e \"process.exit(0)\"", affected: "node -e \"process.exit(0)\" {files}" } });
  try {
    await runCli(["begin", "Check hostile paths"], { cwd: dir });
    await runCli(["brief", "--outcome", "Changed source paths are checked without running their names.", "--accept", "Run the affected check and see success"], { cwd: dir });
    const hostile = "src/evil`touch PWNED`.mjs";
    writeFiles(dir, { [hostile]: "export const safe = true;\n" });
    const result = await runCli(["verify", "--mode", "fast", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(dir, "PWNED")), false, "the shell never evaluates the file name");
    assert.ok(result.json.data.codeFiles.includes(hostile));
  } finally {
    cleanup(dir);
  }
});

test("affected checks reject placeholders inside shell code before hostile names can execute", () => {
  const config = defaultConfig();
  const gate = { cmd: "node -e \"process.exit(0)\"", affected: 'sh -c "echo {files} "' };
  assert.throws(
    () => chooseCommand("test", gate, "fast", ["src/a;touch${IFS}PWNED;#.js"], config, process.cwd()),
    /unsafe \{files\} placeholder/,
  );
  assert.equal(existsSync(join(process.cwd(), "PWNED")), false);
});

test("a passing gate that mutates verification inputs fails and cannot leave a usable receipt", async () => {
  const mutation = "node -e \"require('node:fs').writeFileSync('src/app.mjs','export const value = 999;\\n')\"";
  const dir = await setup({ build: { cmd: mutation } });
  try {
    let result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(result.code, 3, result.stderr || result.stdout);
    assert.match(result.json.operator, /changed the files/i);
    assert.match(readFileSync(join(dir, "src/app.mjs"), "utf8"), /999/);
    let receipt = readJson(join(dir, ".git", "staff-engineer", "verify", "latest-full.json"));
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.reason, "inputs-changed");

    writeFiles(dir, { "src/app.mjs": "export const value = 1;\n" });
    const configPath = join(dir, ".staff-engineer", "config.json");
    const config = readJson(configPath);
    config.gates.build = { cmd: "node -e \"process.exit(0)\"" };
    writeFiles(dir, { ".staff-engineer/config.json": `${JSON.stringify(config, null, 2)}\n` });
    result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.data.status, "passed");

    config.gates.lint = { cmd: "node -e \"process.exit(7)\"" };
    writeFiles(dir, { ".staff-engineer/config.json": `${JSON.stringify(config, null, 2)}\n` });
    result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(result.code, 3);
    receipt = readJson(join(dir, ".git", "staff-engineer", "verify", "latest-full.json"));
    assert.equal(receipt.status, "failed", "a failed rerun replaces the old passing receipt");
  } finally {
    cleanup(dir);
  }
});
