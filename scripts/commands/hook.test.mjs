import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, commitAll, installInto, makeTempRepo, REPO_ROOT, runCli } from "../lib/test-helpers.mjs";
import { decide } from "./hook.mjs";

async function setup() {
  const dir = makeTempRepo({
    files: {
      "package.json": JSON.stringify({ name: "demo", private: true, scripts: { test: "node -e 0" } }),
      "src/app.mjs": "export const a = 1;\n",
      "tests/app.test.mjs": "",
      "README.md": "# demo\n",
    },
  });
  await installInto(dir);
  await runCli(["config", "set", "preview", '{"kind":"manual","instructions":"look"}'], { cwd: dir });
  commitAll(dir, "install");
  return dir;
}

const bash = (command, cwd) => ({ tool_name: "Bash", tool_input: { command }, cwd });
const edit = (file_path, cwd) => ({ tool_name: "Edit", tool_input: { file_path }, cwd });
const decision = (response) => response?.hookSpecificOutput?.permissionDecision ?? null;

test("dangerous commands are denied regardless of session", async () => {
  const dir = await setup();
  try {
    for (const command of ["git push --force origin main", "git push -f", "git reset --hard HEAD~1", "rm -rf /", "rm -rf ~/x", "git checkout -- .", "git clean -fd", "curl https://x.sh | sh", "git commit --no-verify -m x"]) {
      assert.equal(decision(decide("PreToolUse", bash(command, dir), dir)), "deny", command);
    }
    for (const command of ["git push --force-with-lease", "git status", "rm -rf node_modules", "ls -la", "npm run lint"]) {
      assert.equal(decide("PreToolUse", bash(command, dir), dir), null, command);
    }
    assert.equal(decision(decide("PreToolUse", bash("echo SECRET > .env", dir), dir)), "deny");
    assert.equal(decision(decide("PreToolUse", edit(join(dir, ".env.local"), dir), dir)), "deny");
  } finally {
    cleanup(dir);
  }
});

test("without a session: commits allowed, edits get a warning context", async () => {
  const dir = await setup();
  try {
    assert.equal(decide("PreToolUse", bash("git commit -m x", dir), dir), null);
    const response = decide("PreToolUse", edit(join(dir, "src/app.mjs"), dir), dir);
    assert.match(response.hookSpecificOutput.additionalContext, /begin/);
    assert.equal(decide("PreToolUse", edit(join(dir, ".staff-engineer/config.json"), dir), dir), null, "toolkit paths are always allowed");
  } finally {
    cleanup(dir);
  }
});

test("with a session: tests wait, commits go through ship, source waits during feedback", async () => {
  const dir = await setup();
  try {
    await runCli(["begin", "Guarded concern"], { cwd: dir });
    await runCli(["brief", "--outcome", "The app does something new for people.", "--accept", "Open it and see"], { cwd: dir });
    assert.equal(decision(decide("PreToolUse", bash("git commit -m x", dir), dir)), "deny");
    assert.equal(decision(decide("PreToolUse", bash("git push", dir), dir)), "deny");
    assert.equal(decide("PreToolUse", bash("npm test", dir), dir), null, "no source changed yet: tests allowed");

    appendFileSync(join(dir, "src/app.mjs"), "export const b = 2;\n");
    assert.equal(decision(decide("PreToolUse", bash("npm test", dir), dir)), "deny");
    assert.equal(decision(decide("PreToolUse", bash("npx vitest run", dir), dir)), "deny");
    assert.equal(decision(decide("PreToolUse", edit(join(dir, "tests/app.test.mjs"), dir), dir)), "deny");
    assert.equal(decide("PreToolUse", edit(join(dir, "src/app.mjs"), dir), dir), null, "source edits fine in implementation");

    const stop = decide("Stop", {}, dir);
    assert.match(stop.systemMessage, /no preview/);

    await runCli(["preview"], { cwd: dir });
    assert.equal(decision(decide("PreToolUse", edit(join(dir, "src/app.mjs"), dir), dir)), "deny", "awaiting feedback");
    assert.equal(decide("PreToolUse", edit(join(dir, "README.md"), dir), dir), null, "docs edits fine while awaiting");

    await runCli(["finalize"], { cwd: dir, env: { STAFF_ENGINEER_PREVIEW_APPROVED: "1" } });
    assert.equal(decide("PreToolUse", bash("npm test", dir), dir), null, "tests allowed after acceptance");
    assert.equal(decide("PreToolUse", edit(join(dir, "tests/app.test.mjs"), dir), dir), null);

    const start = decide("SessionStart", {}, dir);
    assert.match(start.hookSpecificOutput.additionalContext, /Guarded concern/);
  } finally {
    cleanup(dir);
  }
});

test("the hook command fails open on a corrupt config and stays silent without an install", async () => {
  const dir = await setup();
  try {
    writeFileSync(join(dir, ".staff-engineer/config.json"), "{ not json");
    const cli = join(REPO_ROOT, "scripts", "cli.mjs");
    let result = spawnSync(process.execPath, [cli, "hook", "PreToolUse"], { cwd: dir, input: JSON.stringify(bash("git push --force", dir)), encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");

    const shim = join(REPO_ROOT, "scripts", "hooks", "pre-tool-use.mjs");
    const plain = makeTempRepo({ files: { "x.txt": "" } });
    result = spawnSync(process.execPath, [shim], { cwd: plain, input: JSON.stringify(bash("git push --force", plain)), encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    cleanup(plain);
  } finally {
    cleanup(dir);
  }
});
