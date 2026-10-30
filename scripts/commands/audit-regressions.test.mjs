import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { cleanup, commitAll, git, installInto, makeTempDir, makeTempRepo, runCli, writeFiles } from "../lib/test-helpers.mjs";
import { approvalStillCurrent, assertDeliveryNotWithdrawn, checkApproval, recordOperatorMessage } from "../lib/approval.mjs";
import { loadConfig, defaultConfig } from "../lib/config.mjs";
import { readSession, writeSession } from "../lib/session.mjs";
import { readReceipt, receiptMatches, batchFingerprint } from "../lib/receipt.mjs";
import { readHistory } from "../lib/history.mjs";
import { runRepro } from "../lib/repro.mjs";
import { pendingToolkitFiles, saveToolkit } from "../lib/maintenance.mjs";
import { upsertBlock } from "../lib/managed-block.mjs";
import { acquireSaveLock, readJson, writeJson } from "../lib/fs-safe.mjs";
import { stagedEntry, stateDir } from "../lib/git.mjs";
import { deliver, shippingTarget } from "../lib/shipping.mjs";
import { uncoveredSourceAreas } from "../lib/test-coverage.mjs";
import { decide } from "./hook.mjs";
import { withClaudeHooks } from "./install.mjs";

async function cli(cwd, ...args) {
  const result = await runCli([...args, "--json"], { cwd });
  assert.equal(result.code, 0, result.stdout || result.stderr);
  return result.json;
}
async function setup(files = { "README.md": "# Demo\n" }) {
  const cwd = makeTempRepo({ files });
  await installInto(cwd);
  await cli(cwd, "autonomy", "guided", "--remember", "--instruction", "Check with me along the way");
  const config = loadConfig(cwd);
  config.gates = Object.fromEntries(["install", "format", "lint", "typecheck", "test", "build", "e2e"].map((name) => [name, null]));
  writeFiles(cwd, { ".staff-engineer/config.json": `${JSON.stringify(config, null, 2)}\n` });
  commitAll(cwd, "Install toolkit");
  return cwd;
}
async function acceptedDocs(cwd, lane = "standard") {
  await cli(cwd, "begin", "Improve project documentation", "--lane", lane);
  await cli(cwd, "brief", "--outcome", "People can read the helpful project note.", "--accept", "Read the new note");
  writeFiles(cwd, { "README.md": "# Demo\n\nA helpful note.\n" });
  await cli(cwd, "preview");
  await cli(cwd, "finalize", "--approval-quote", "looks good");
  git(cwd, "add", "README.md");
  await cli(cwd, "verify", "--mode", "full");
  if (lane !== "trivial") await cli(cwd, "handoff");
}
function bareRemote() { const remote = makeTempDir(); git(remote, "init", "--bare", "--quiet"); return remote; }
const bash = (cwd, command) => decide("PreToolUse", { cwd, tool_name: "Bash", tool_input: { command } }, cwd);
const decision = (response) => response?.hookSpecificOutput?.permissionDecision;

test("a toolkit installation can make and deliver the first commit on an unborn branch", async () => {
  const cwd = makeTempRepo({ commit: false, files: { "README.md": "# Demo\n" } }), remote = bareRemote();
  try {
    await installInto(cwd);
    await cli(cwd, "autonomy", "guided", "--remember", "--instruction", "Check with me along the way");
    git(cwd, "remote", "add", "origin", remote);
    const saved = saveToolkit(cwd, "Install the staff engineer toolkit");
    assert.equal(saved.pushed, true);
    assert.equal(git(remote, "rev-parse", "refs/heads/main"), saved.commit);
    assert.equal(git(cwd, "show", "--format=%P", "--no-patch", "HEAD"), "");
    assert.deepEqual(pendingToolkitFiles(cwd), []);
    assert.match(git(cwd, "status", "--short"), /\?\? README\.md/);
  } finally { cleanup(cwd); cleanup(remote); }
});

test("shipping defaults to confirmed delivery on origin and on a differently named remote", async () => {
  for (const name of ["origin", "shared"]) {
    const cwd = await setup(), remote = bareRemote();
    try {
      git(cwd, "remote", "add", name, remote);
      git(cwd, "push", "-u", name, "main");
      await acceptedDocs(cwd);
      const result = await cli(cwd, "ship", "Document the project note", "--approval-quote", "ship it");
      assert.equal(result.data.pushed, true);
      assert.equal(result.data.status, "synced");
      assert.equal(git(remote, "rev-parse", "refs/heads/main"), result.data.commit);
    } finally { cleanup(cwd); cleanup(remote); }
  }
});

test("matching push defaults cannot skip the saved branch or push unrelated branches", async () => {
  const cwd = await setup(), remote = bareRemote();
  try {
    git(cwd, "remote", "add", "origin", remote); git(cwd, "push", "-u", "origin", "main");
    git(cwd, "checkout", "-b", "feature"); git(cwd, "branch", "--set-upstream-to=origin/main", "feature");
    git(cwd, "config", "push.default", "matching");
    await acceptedDocs(cwd);
    const result = await cli(cwd, "ship", "Document the feature note", "--approval-quote", "ship it");
    assert.equal(git(remote, "rev-parse", "refs/heads/main"), result.data.commit);
    assert.equal(git(remote, "show-ref", "--verify", "refs/heads/feature"), "");
  } finally { cleanup(cwd); cleanup(remote); }
});

test("delivery confirms the push URL and accepts a branch that already contains the saved commit", async () => {
  const cwd = await setup(), fetchRemote = bareRemote(), pushRemote = bareRemote();
  try {
    git(cwd, "remote", "add", "origin", fetchRemote); git(cwd, "push", "-u", "origin", "main");
    const base = git(cwd, "rev-parse", "HEAD");
    git(cwd, "remote", "set-url", "--push", "origin", pushRemote);
    await acceptedDocs(cwd);
    const result = await cli(cwd, "ship", "Document the project note", "--approval-quote", "ship it");
    assert.equal(git(pushRemote, "rev-parse", "refs/heads/main"), result.data.commit);
    assert.equal(git(fetchRemote, "rev-parse", "refs/heads/main"), base);
    writeFiles(cwd, { "later.md": "A later writer's work.\n" }); commitAll(cwd, "Add later work");
    git(cwd, "push", "origin", "HEAD:main");
    const advanced = git(cwd, "rev-parse", "HEAD");
    assert.equal(deliver(cwd, result.data.commit, shippingTarget(cwd, loadConfig(cwd))), true);
    assert.equal(git(pushRemote, "rev-parse", "refs/heads/main"), advanced);
  } finally { cleanup(cwd); cleanup(fetchRemote); cleanup(pushRemote); }
});

test("shipping refuses ambiguous destinations before committing and supports explicit local work", async () => {
  const cwd = await setup(), remote = bareRemote();
  try {
    const config = loadConfig(cwd);
    git(cwd, "remote", "add", "one", remote); git(cwd, "remote", "add", "two", remote);
    assert.throws(() => shippingTarget(cwd, config), /ambiguous/);
    config.shipping.remote = "one";
    git(cwd, "remote", "set-url", "--add", "--push", "one", remote);
    git(cwd, "remote", "set-url", "--add", "--push", "one", join(remote, "other"));
    assert.throws(() => shippingTarget(cwd, config), /unambiguous push/);
    config.shipping.mode = "local";
    writeFiles(cwd, { ".staff-engineer/config.json": `${JSON.stringify(config)}\n` }); commitAll(cwd, "Configure local work");
    await acceptedDocs(cwd);
    const result = await cli(cwd, "ship", "Document the local project", "--approval-quote", "ship it");
    assert.equal(result.data.delivery, "local");
    config.shipping.mode = "auto"; git(cwd, "checkout", "--detach");
    assert.throws(() => shippingTarget(cwd, config), /named branch/);
  } finally { cleanup(cwd); cleanup(remote); }
});

test("failed delivery stays visible, cannot be aborted, and recovers a crash without another commit", async () => {
  const cwd = await setup(), remote = bareRemote();
  try {
    git(cwd, "remote", "add", "origin", join(cwd, "missing.git"));
    await acceptedDocs(cwd);
    const result = await runCli(["ship", "Document the project note", "--approval-quote", "ship it", "--json"], { cwd });
    assert.equal(result.code, 2);
    const saved = readSession(cwd);
    assert.equal(saved.status, "saved");
    assert.match(decide("SessionStart", {}, cwd).hookSpecificOutput.additionalContext, /Next: sync/);
    assert.match(decide("Stop", {}, cwd).hookSpecificOutput.additionalContext, /--sync-only/);
    assert.equal(decide("Stop", { stop_hook_active: true }, cwd), null);
    assert.equal((await runCli(["abort", "--discard-confirmed", "--json"], { cwd })).code, 1);
    // Simulate interruption between git commit and persistence of markSaved.
    writeSession(cwd, { ...saved, status: "open", savedCommit: undefined });
    git(cwd, "remote", "set-url", "origin", remote);
    const recovered = await cli(cwd, "ship", "--sync-only");
    assert.equal(recovered.data.commit, saved.savedCommit);
    assert.equal(git(remote, "rev-parse", "refs/heads/main"), saved.savedCommit);
    assert.equal(readHistory(cwd).filter((entry) => entry.commit === saved.savedCommit).length, 1);
  } finally { cleanup(cwd); cleanup(remote); }
});

test("a commit hook cannot add an unchecked file or send an altered batch", async () => {
  const cwd = await setup(), remote = bareRemote();
  try {
    git(cwd, "remote", "add", "origin", remote); git(cwd, "push", "-u", "origin", "main");
    const base = git(cwd, "rev-parse", "HEAD");
    await acceptedDocs(cwd);
    writeFiles(cwd, { ".git/hooks/pre-commit": "#!/bin/sh\nprintf 'unchecked\\n' > injected.txt\ngit add injected.txt\n" });
    chmodSync(join(cwd, ".git/hooks/pre-commit"), 0o755);
    let result = await runCli(["ship", "Document the project note", "--approval-quote", "ship it", "--json"], { cwd });
    assert.equal(result.code, 1);
    assert.match(result.json.operator, /hooks changed/);
    assert.equal(git(remote, "rev-parse", "refs/heads/main"), base);
    assert.equal((await runCli(["ship", "--sync-only", "--json"], { cwd })).code, 1);
    git(cwd, "reset", "--soft", base);
    await cli(cwd, "ship", "--recover");
    assert.equal(readSession(cwd).phase, "implementation");
    assert.ok(readFileSync(join(cwd, "injected.txt"), "utf8"));
    assert.equal(readSession(cwd).acceptance, undefined);
  } finally { cleanup(cwd); cleanup(remote); }
});

test("a failed commit can resume its exact journal without repeating metadata or approval", async () => {
  const cwd = await setup();
  try {
    await acceptedDocs(cwd);
    writeFiles(cwd, { ".git/hooks/pre-commit": "#!/bin/sh\nexit 1\n" }); chmodSync(join(cwd, ".git/hooks/pre-commit"), 0o755);
    const result = await runCli(["ship", "Document the project note", "--approval-quote", "ship it", "--json"], { cwd });
    assert.equal(result.code, 2);
    assert.ok(readSession(cwd).shipping);
    rmSync(join(cwd, ".git/hooks/pre-commit"));
    const resumed = await cli(cwd, "ship");
    assert.equal(resumed.data.status, "synced");
    assert.equal(git(cwd, "log", "-1", "--format=%s"), "Document the project note");
  } finally { cleanup(cwd); }
});

test("a later withdrawal pauses pending delivery until fresh approval of the same commit", async () => {
  const cwd = await setup(), remote = bareRemote();
  try {
    git(cwd, "remote", "add", "origin", join(cwd, "missing.git"));
    await acceptedDocs(cwd); recordOperatorMessage(cwd, "Ship it");
    assert.equal((await runCli(["ship", "Document the project note", "--approval-quote", "ship it", "--json"], { cwd })).code, 2);
    const saved = readSession(cwd).savedCommit;
    recordOperatorMessage(cwd, "Hold, do not push yet"); git(cwd, "remote", "set-url", "origin", remote);
    assert.equal((await runCli(["ship", "--sync-only", "--json"], { cwd })).code, 1);
    assert.equal(git(remote, "show-ref", "--verify", "refs/heads/main"), "");
    recordOperatorMessage(cwd, "Ship it, no changes needed");
    const result = await cli(cwd, "ship", "--sync-only", "--approval-quote", "ship it");
    assert.equal(result.data.commit, saved);
    assert.equal(git(remote, "rev-parse", "refs/heads/main"), saved);
  } finally { cleanup(cwd); cleanup(remote); }
});

test("an interrupted commit accepts fresh approval after later feedback without losing its journal", async () => {
  const cwd = await setup();
  try {
    await acceptedDocs(cwd);
    recordOperatorMessage(cwd, "Ship it");
    writeFiles(cwd, { ".git/hooks/pre-commit": "#!/bin/sh\nexit 1\n" });
    chmodSync(join(cwd, ".git/hooks/pre-commit"), 0o755);
    assert.equal((await runCli(["ship", "Document the approved note", "--approval-quote", "ship it", "--json"], { cwd })).code, 2);
    const expectedTree = readSession(cwd).shipping.expectedTree;
    recordOperatorMessage(cwd, "Hold");
    rmSync(join(cwd, ".git/hooks/pre-commit"));
    assert.equal((await runCli(["ship", "--json"], { cwd })).code, 1);
    recordOperatorMessage(cwd, "Save the unchanged note");
    const resumed = await cli(cwd, "ship", "--approval-quote", "Save the unchanged note");
    assert.equal(resumed.data.status, "synced");
    assert.equal(git(cwd, "rev-parse", "HEAD^{tree}"), expectedTree);
    assert.match(git(cwd, "log", "-1", "--format=%B"), /Operator-Approval: Save the unchanged note/);
    assert.equal(git(cwd, "log", "-1", "--format=%s"), "Document the approved note");
  } finally { cleanup(cwd); }
});

test("approval cannot be extracted from refusal, conditions, questions, truncation, or superseded replies", () => {
  const cwd = makeTempRepo();
  try {
    for (const reply of ["Do not ship it; the login is broken.", "Ship it if you fix the login", "Looks good, but please change the title", "Should we ship it?", `Ship it ${"x".repeat(2000)} but wait`]) {
      recordOperatorMessage(cwd, reply);
      assert.throws(() => checkApproval(cwd, reply.includes("Looks") ? "looks good" : "ship it", { purpose: "Saving" }));
    }
    recordOperatorMessage(cwd, "Great work — ship it, thanks");
    const approval = checkApproval(cwd, "ship it", { purpose: "Saving" });
    approvalStillCurrent(cwd, approval);
    recordOperatorMessage(cwd, "Hold, change the title first");
    assert.throws(() => checkApproval(cwd, "ship it", { purpose: "Saving" }));
    assert.throws(() => approvalStillCurrent(cwd, approval));
  } finally { cleanup(cwd); }
});

test("a plain negative reply withdraws pending delivery while retry requests preserve approval", () => {
  const cwd = makeTempRepo();
  try {
    for (const reply of ["No.", "Nope", "No, that version is wrong"]) {
      recordOperatorMessage(cwd, "Ship it");
      const approval = checkApproval(cwd, "ship it", { purpose: "Saving" });
      recordOperatorMessage(cwd, reply);
      assert.throws(() => assertDeliveryNotWithdrawn(cwd, approval), /pause or change/);
    }
    recordOperatorMessage(cwd, "Ship it");
    const approval = checkApproval(cwd, "ship it", { purpose: "Saving" });
    recordOperatorMessage(cwd, "Please retry delivery, no changes needed");
    assert.doesNotThrow(() => assertDeliveryNotWithdrawn(cwd, approval));
  } finally { cleanup(cwd); }
});

test("changing prose needs fresh documentation checks and retains preview or handoff approval", async () => {
  for (const lane of ["trivial", "standard"]) {
    const cwd = await setup();
    try {
      await acceptedDocs(cwd, lane);
      writeFiles(cwd, { "README.md": "# A different result\n" }); git(cwd, "add", "README.md");
      assert.equal(receiptMatches(readReceipt(cwd), cwd, loadConfig(cwd)), false);
      const result = await runCli(["ship", "Replace the project note", "--approval-quote", "ship it", "--json"], { cwd });
      assert.equal(result.code, 1);
      if (lane === "standard") {
        await cli(cwd, "verify", "--mode", "full");
        assert.equal(readReceipt(cwd).scope, "documentation");
        assert.equal((await cli(cwd, "next")).data.step, "handoff");
        await cli(cwd, "handoff");
        await cli(cwd, "ship", "Replace the project note", "--approval-quote", "ship it");
      }
    } finally { cleanup(cwd); }
  }
});

test("review counts require every finding to have a disposition and refutations need evidence", async () => {
  const cwd = await setup({ "README.md": "# Demo\n", "src/app.mjs": "export const a = 1;\n" });
  try {
    await cli(cwd, "begin", "Improve application value", "--lane", "trivial");
    await cli(cwd, "brief", "--outcome", "People can see the corrected value.", "--accept", "See the value");
    writeFiles(cwd, { "src/app.mjs": "export const a = 2;\n" }); await cli(cwd, "review");
    assert.equal((await runCli(["review", "done", "--found", "3", "--fixed", "0", "--reported", "0", "--json"], { cwd })).code, 1);
    assert.equal((await runCli(["review", "done", "--found", "1", "--refuted", "1", "--json"], { cwd })).code, 1);
    const result = await cli(cwd, "review", "done", "--found", "1", "--refuted", "1", "--refutation", "The caller already checks this input and the existing regression test proves that the proposed failure cannot occur.");
    assert.equal(result.data.review.refuted, 1);
  } finally { cleanup(cwd); }
});

test("shell guards cover Git global options and ordinary mutations while feedback is pending", async () => {
  const cwd = await setup({ "README.md": "# Demo\n", "src/app.mjs": "export const a = 1;\n" });
  try {
    await cli(cwd, "begin", "Improve the application"); await cli(cwd, "brief", "--outcome", "People can see the helpful note.", "--accept", "Read it");
    writeFiles(cwd, { "README.md": "# Changed\n" }); await cli(cwd, "preview");
    for (const command of ["git -C . commit -m example", "git -c user.name=Demo push", '"git" --git-dir=.git commit -m example', "echo changed > src/app.mjs", "cp README.md src/app.mjs", "cd src && tee app.mjs", "git -C . reset --hard HEAD"]) assert.equal(decision(bash(cwd, command)), "deny", command);
    assert.equal(bash(cwd, "git status"), null);
    assert.equal(bash(cwd, "node --test"), null);
    for (const command of ["rg git commit README.md", "echo git push", "env LABEL=git printf commit"]) {
      assert.equal(bash(cwd, command), null, command);
    }
    for (const command of ["LABEL=demo git commit -m example", "env -u LABEL git commit -m example", "command git push"]) {
      assert.equal(decision(bash(cwd, command)), "deny", command);
    }
  } finally { cleanup(cwd); }
});

test("installed hooks run from a nested working directory", async () => {
  const cwd = await setup({ "README.md": "# Demo\n", "src/app.mjs": "export const a = 1;\n" });
  try {
    await cli(cwd, "begin", "Guard nested directory");
    const command = withClaudeHooks({}).hooks.PreToolUse[0].hooks[0].command;
    const result = spawnSync(command, { cwd: join(cwd, "src"), shell: true, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd }, input: JSON.stringify({ cwd: join(cwd, "src"), tool_name: "Bash", tool_input: { command: "git -C .. commit -m example" } }), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(decision(JSON.parse(result.stdout)), "deny");
  } finally { cleanup(cwd); }
});

test("base reproduction excludes ignored credentials and data and copies dependency writes", () => {
  const cwd = makeTempRepo({ files: { ".gitignore": ".env\nlocal-data/\nnode_modules/\n", "src/app.mjs": "export const a = 1;\n", "tests/app.test.mjs": "// base test\n" } });
  try {
    writeFiles(cwd, { "src/app.mjs": "export const a = 2;\n", "tests/app.test.mjs": "// reproducing test\n", ".env": "fake-placeholder\n", "local-data/sentinel.txt": "original", "node_modules/cache.txt": "original" });
    const command = `node -e "const fs=require('fs'); const fixed=fs.readFileSync('src/app.mjs','utf8').includes('= 2'); if(!fixed){ if(fs.existsSync('.env') || fs.existsSync('local-data')) throw Error('unexpected shared data'); fs.writeFileSync('node_modules/cache.txt','changed in base'); } process.exit(fixed ? 0 : 1)"`;
    const result = runRepro(cwd, defaultConfig(), { baseCommit: git(cwd, "rev-parse", "HEAD"), baseline: { files: [] } }, command);
    assert.equal(result.now.ok, true);
    assert.equal(result.base.ok, false);
    assert.equal(result.base.setup, false);
    assert.equal(result.base.tail, "");
    assert.equal(readFileSync(join(cwd, "node_modules/cache.txt"), "utf8"), "original");
    assert.equal(readFileSync(join(cwd, "local-data/sentinel.txt"), "utf8"), "original");
  } finally { cleanup(cwd); }
});

test("mode changes invalidate verification and symlinks hash their link text", async () => {
  const cwd = await setup();
  try {
    writeFiles(cwd, { "scripts/run.mjs": "export const value = 1;\n" }); git(cwd, "add", "scripts/run.mjs");
    await cli(cwd, "verify", "--mode", "full");
    chmodSync(join(cwd, "scripts/run.mjs"), 0o755); git(cwd, "add", "scripts/run.mjs");
    assert.equal(receiptMatches(readReceipt(cwd), cwd, loadConfig(cwd)), false);
    symlinkSync("README.md", join(cwd, "link.mjs")); git(cwd, "add", "link.mjs");
    assert.equal(batchFingerprint(cwd, "working").digest, batchFingerprint(cwd, "staged").digest);
  } finally { cleanup(cwd); }
});

test("test pairing covers every source area, including integration imports and colocated language conventions", () => {
  const cwd = makeTempRepo();
  try {
    const config = defaultConfig();
    writeFiles(cwd, { "src/cart/total.mjs": "export const total = 1;\n", "src/auth/login.mjs": "export const login = 1;\n", "tests/total.test.mjs": "// cart coverage\n" }); git(cwd, "add", "-A");
    let files = ["src/cart/total.mjs", "src/auth/login.mjs", "tests/total.test.mjs"];
    assert.deepEqual(uncoveredSourceAreas(cwd, config, files), ["src/auth"]);
    writeFiles(cwd, { "tests/integration.test.mjs": 'import "../src/auth/login.mjs";\n' }); git(cwd, "add", "tests/integration.test.mjs");
    assert.deepEqual(uncoveredSourceAreas(cwd, config, [...files, "tests/integration.test.mjs"]), []);
    writeFiles(cwd, { "main.go": "package main\n", "main_test.go": "package main\n" }); git(cwd, "add", "main.go", "main_test.go");
    assert.deepEqual(uncoveredSourceAreas(cwd, config, ["main.go", "main_test.go"]), []);
  } finally { cleanup(cwd); }
});

test("toolkit saves only managed portions while preserving unrelated staged and unstaged edits", async () => {
  const cwd = await setup({ "README.md": "# Demo\n", "AGENTS.md": "Operator original instructions.\n" });
  try {
    const path = join(cwd, "AGENTS.md");
    const original = readFileSync(path, "utf8");
    const changed = upsertBlock(original.replace("Operator original", "Operator staged"), "staff-engineer", "Updated toolkit instructions.").text;
    writeFiles(cwd, { "AGENTS.md": changed }); git(cwd, "add", "AGENTS.md");
    chmodSync(path, 0o755); git(cwd, "add", "AGENTS.md");
    writeFiles(cwd, { "AGENTS.md": `${changed}\nOperator unstaged instructions.\n`, "other.md": "unrelated staged work\n" }); git(cwd, "add", "other.md");
    const saved = saveToolkit(cwd, "Update toolkit instructions");
    const committed = git(cwd, "show", "HEAD:AGENTS.md");
    assert.match(committed, /Operator original/);
    assert.match(committed, /Updated toolkit instructions/);
    assert.doesNotMatch(committed, /Operator staged|Operator unstaged/);
    assert.match(git(cwd, "diff", "--cached", "--", "AGENTS.md"), /Operator staged/);
    assert.match(git(cwd, "ls-tree", "HEAD", "AGENTS.md"), /^100644/);
    assert.equal(stagedEntry("AGENTS.md", cwd).mode, "100755");
    assert.match(git(cwd, "diff", "--", "AGENTS.md"), /Operator unstaged/);
    assert.match(git(cwd, "diff", "--cached", "--name-only"), /other.md/);
    assert.deepEqual(pendingToolkitFiles(cwd), []);
    assert.equal(saved.pushed, false);
  } finally { cleanup(cwd); }
});

test("maintenance delivery recovers a crash and reconciles the index without a second commit", async () => {
  const cwd = await setup(), remote = bareRemote();
  try {
    git(cwd, "remote", "add", "origin", join(cwd, "missing.git"));
    writeFiles(cwd, { "AGENTS.md": upsertBlock(readFileSync(join(cwd, "AGENTS.md"), "utf8"), "staff-engineer", "New toolkit instructions.").text, "other.md": "Operator staged work.\n" });
    git(cwd, "add", "other.md");
    assert.throws(() => saveToolkit(cwd, "Update toolkit instructions"), (error) => /save-toolkit/.test(error.agent));
    const path = join(stateDir(cwd), "maintenance-save.json");
    const journal = readJson(path), saved = git(cwd, "rev-parse", "HEAD");
    // Crash after Git commits but before the saved commit and real index are persisted.
    for (const [file, entry] of Object.entries(journal.indexBefore)) {
      if (entry) git(cwd, "update-index", "--add", "--cacheinfo", entry.mode, entry.hash, file);
      else git(cwd, "update-index", "--force-remove", "--", file);
    }
    delete journal.savedCommit; writeJson(path, journal);
    assert.match(decide("Stop", {}, cwd).hookSpecificOutput.additionalContext, /save-toolkit/);
    assert.equal((await cli(cwd, "next")).data.step, "resume-toolkit-save");
    git(cwd, "remote", "set-url", "origin", remote);
    assert.equal(saveToolkit(cwd, "Do not create another commit").commit, saved);
    assert.equal(git(remote, "rev-parse", "refs/heads/main"), saved);
    assert.match(git(cwd, "diff", "--cached", "--name-only"), /other.md/);
    assert.deepEqual(pendingToolkitFiles(cwd), []);
    assert.equal(readJson(path, null), null);
  } finally { cleanup(cwd); cleanup(remote); }
});

test("save locks exclude concurrent commits and recover a stopped process", () => {
  const root = makeTempDir();
  try {
    const release = acquireSaveLock(root);
    assert.throws(() => acquireSaveLock(root), /Another save is running/);
    release();
    const stopped = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    writeJson(join(root, "save.lock"), { pid: stopped.pid, token: "stale" });
    const recovered = acquireSaveLock(root);
    assert.notEqual(readJson(join(root, "save.lock")).token, "stale");
    recovered();
    assert.equal(readJson(join(root, "save.lock"), null), null);
  } finally { cleanup(root); }
});
