import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { cleanup, commitAll, git, installInto, makeTempRepo, runCli, writeFiles } from "../lib/test-helpers.mjs";
import { loadConfig, saveConfig } from "../lib/config.mjs";
import { readSession } from "../lib/session.mjs";
import { recordOperatorMessage } from "../lib/approval.mjs";
import { validateEvidence } from "../lib/acceptance.mjs";
import { decide } from "./hook.mjs";
import { isInterruption } from "../lib/autonomy.mjs";

async function cli(cwd, ...args) {
  const result = await runCli([...args, "--json"], { cwd });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return result.json;
}
async function setup(deployment = null) {
  const cwd = makeTempRepo({ files: { "README.md": "# Demo\n" } });
  await installInto(cwd);
  const config = loadConfig(cwd);
  config.gates = Object.fromEntries(["install", "format", "lint", "typecheck", "test", "build", "e2e"].map((name) => [name, null]));
  config.deployment = deployment;
  saveConfig(cwd, config);
  commitAll(cwd, "Install toolkit");
  return cwd;
}
async function build(cwd, lane = "standard") {
  const started = await cli(cwd, "begin", "Improve project documentation", "--lane", lane);
  await cli(cwd, "brief", "--outcome", "Readers can find the new project note.", "--accept", "Read the helpful note");
  writeFiles(cwd, { "README.md": "# Demo\n\nA helpful note.\n" });
  await cli(cwd, "preview");
  return started;
}
async function accept(cwd, override = {}) {
  const evidence = { criteria: [{ criterion: 1, status: "passed", evidence: "Opened README and read the helpful note in its context." }], visual: { status: "not-applicable", evidence: "This change is plain text documentation without a rendered interface." }, ...override };
  writeFiles(cwd, { ".git/staff-engineer/evidence.json": JSON.stringify(evidence) });
  return cli(cwd, "acceptance", ".git/staff-engineer/evidence.json");
}
async function finish(cwd) {
  await accept(cwd);
  git(cwd, "add", "README.md");
  await cli(cwd, "lifecycle");
  await cli(cwd, "verify", "--mode", "full");
  await cli(cwd, "handoff");
}

test("new and existing installations default to final approval, including trivial tasks", async () => {
  for (const lane of ["standard", "trivial"]) {
    const cwd = await setup();
    try {
      const started = await build(cwd, lane);
      assert.equal(started.data.autonomy.mode, "final-approval");
      assert.match(started.operator, /^\*\*Autonomy: Final approval\*\*/);
      assert.equal((await cli(cwd, "next")).data.step, "acceptance");
      assert.equal((await runCli(["finalize", "--approval-quote", "looks good"], { cwd })).code, 1);
      assert.equal((await runCli(["acceptance", "missing.json"], { cwd })).code > 0, true);
      await finish(cwd);
      assert.equal((await cli(cwd, "next")).data.step, "await-approval");
      assert.equal((await runCli(["ship", "Document the helpful note"], { cwd })).code, 1);
      const shipped = await cli(cwd, "ship", "Document the helpful note", "--approval-quote", "ship it");
      assert.equal(readSession(cwd).status, "synced");
      assert.equal(shipped.data.releaseOffer.commit, readSession(cwd).savedCommit);
      assert.ok(shipped.operator.includes(shipped.data.releaseOffer.question));
      assert.equal((await cli(cwd, "next")).data.step, "begin", "ignoring a release offer never blocks new work");
    } finally { cleanup(cwd); }
  }
});

test("autonomous mode ships without inventing operator approval and task overrides expire", async () => {
  const cwd = await setup();
  try {
    await build(cwd);
    await cli(cwd, "autonomy", "autonomous", "--instruction", "Just handle this through delivery");
    await finish(cwd);
    assert.equal((await cli(cwd, "next")).data.step, "ship");
    const shipped = await cli(cwd, "ship", "Document the helpful note");
    assert.equal(shipped.data.releaseOffer.commit, readSession(cwd).savedCommit, "autonomy still offers rather than starts a release");
    const response = decide("UserPromptSubmit", { prompt: "yes" }, cwd);
    assert.match(response.hookSpecificOutput.additionalContext, /release.md/);
    assert.equal(readSession(cwd).status, "synced", "a reply supplies guidance, not an automatic publication side effect");
    const message = git(cwd, "log", "-1", "--format=%B");
    assert.match(message, /Approval-Evidence: autonomy-policy/);
    assert.doesNotMatch(message, /Operator-Approval:/);
    const started = await cli(cwd, "begin", "Another documentation task");
    assert.equal(started.data.autonomy.mode, "final-approval");
  } finally { cleanup(cwd); }
});

test("remembered preference survives tasks; switching to guided requires a fresh preview", async () => {
  const cwd = await setup();
  try {
    await cli(cwd, "autonomy", "autonomous", "--remember", "--instruction", "From now on handle delivery yourself");
    assert.equal((await build(cwd)).data.autonomy.mode, "autonomous");
    await accept(cwd);
    await cli(cwd, "autonomy", "guided", "--instruction", "Walk me through this one");
    assert.equal(readSession(cwd).phase, "implementation");
    await cli(cwd, "preview");
    assert.equal((await cli(cwd, "next")).data.waitFor, "operator");
    assert.equal((await runCli(["acceptance", ".git/staff-engineer/evidence.json"], { cwd })).code, 1);
    await cli(cwd, "finalize", "--approval-quote", "looks good");
  } finally { cleanup(cwd); }
});

test("failed, missing, duplicate and uninspected visual evidence cannot pass", () => {
  const brief = { acceptance: ["First", "Second"] };
  const valid = { criteria: [1, 2].map((criterion) => ({ criterion, status: "passed", evidence: "Clicked the control and observed the expected result." })), visual: { status: "passed", evidence: "Inspected desktop and mobile layouts; no clipping or overlap.", artifacts: ["browser://capture/home"] } };
  assert.doesNotThrow(() => validateEvidence(valid, brief, { preview: { kind: "web" } }));
  for (const invalid of [
    { ...valid, criteria: valid.criteria.slice(0, 1) },
    { ...valid, criteria: [valid.criteria[0], valid.criteria[0]] },
    { ...valid, criteria: [valid.criteria[0], { ...valid.criteria[1], status: "blocked" }] },
    { ...valid, visual: { ...valid.visual, status: "not-applicable" } },
    { ...valid, visual: { ...valid.visual, artifacts: [] } },
  ]) assert.throws(() => validateEvidence(invalid, brief, { preview: { kind: "web" } }));
});

test("editing the accepted batch invalidates agent evidence even when tests remain current", async () => {
  const cwd = await setup();
  try {
    await build(cwd);
    await finish(cwd);
    writeFiles(cwd, { "README.md": "# Changed again\n" });
    assert.equal((await cli(cwd, "next")).data.step, "revise");
    assert.equal((await runCli(["handoff"], { cwd })).code, 1);
    assert.equal((await runCli(["acceptance", ".git/staff-engineer/evidence.json"], { cwd })).code, 1);
    assert.equal((await runCli(["ship", "Document the helpful note", "--approval-quote", "ship it"], { cwd })).code, 1);
  } finally { cleanup(cwd); }
});

test("harness steering pauses work and shipping, verifies quotes, and resumes explicitly", async () => {
  const cwd = await setup();
  try {
    await build(cwd);
    await cli(cwd, "autonomy", "autonomous", "--instruction", "Handle this through delivery");
    await finish(cwd);
    decide("UserPromptSubmit", { prompt: "Hold, I want to review this" }, cwd);
    assert.equal((await cli(cwd, "next")).data.step, "paused");
    assert.equal((await runCli(["ship", "Document the helpful note"], { cwd })).code, 1);
    assert.equal((await runCli(["autonomy", "resume", "--instruction", "continue"], { cwd })).code, 1);
    recordOperatorMessage(cwd, "Ask before shipping");
    await cli(cwd, "autonomy", "final-approval", "--instruction", "Ask before shipping");
    await cli(cwd, "handoff");
    assert.equal((await cli(cwd, "next")).data.step, "await-approval");
    recordOperatorMessage(cwd, "ship it");
    await cli(cwd, "ship", "Document the helpful note", "--approval-quote", "ship it");
  } finally { cleanup(cwd); }
});

test("deployment verifies the delivered revision and recovery does not redeploy it", async () => {
  const cwd = await setup({ environment: "staging", cmd: `node -e "require('fs').writeFileSync('.git/live-revision',process.env.STAFF_ENGINEER_COMMIT)"`, verifyCmd: `node -e "process.exit(require('fs').readFileSync('.git/live-revision','utf8')===process.env.STAFF_ENGINEER_COMMIT && require('fs').existsSync('.git/healthy') ? 0 : 1)"`, timeoutMs: 10000 });
  try {
    await cli(cwd, "autonomy", "autonomous", "--remember", "--instruction", "Deploy to staging when ready from now on");
    const started = await build(cwd);
    assert.match(started.operator, /Through delivery → staging/);
    await finish(cwd);
    await cli(cwd, "ship", "Document the helpful note");
    const savedCommit = readSession(cwd).savedCommit;
    assert.equal((await cli(cwd, "next")).data.step, "deploy");
    assert.equal(readSession(cwd).releaseOffer, undefined, "do not offer while deployment is pending");
    assert.equal((await runCli(["begin", "Start another task"], { cwd })).code, 1);
    assert.equal((await runCli(["deploy"], { cwd })).code, 1);
    assert.equal(readSession(cwd).status, "delivered");
    assert.equal(readFileSync(join(cwd, ".git/live-revision"), "utf8"), savedCommit);
    assert.equal((await runCli(["deploy"], { cwd })).code, 1);
    writeFiles(cwd, { ".git/healthy": "yes" });
    const deployed = await cli(cwd, "deploy");
    assert.equal(deployed.data.releaseOffer.commit, savedCommit);
    assert.ok(deployed.operator.includes(deployed.data.releaseOffer.question));
    assert.equal(readSession(cwd).status, "synced");
    assert.equal(readSession(cwd).deployment.status, "verified");
    assert.equal(git(cwd, "rev-parse", "HEAD"), savedCommit);
  } finally { cleanup(cwd); }
});

test("withdrawn autonomous permission blocks an interrupted save until fresh approval", async () => {
  const cwd = await setup();
  try {
    await build(cwd);
    await cli(cwd, "autonomy", "autonomous", "--instruction", "Handle delivery yourself");
    await finish(cwd);
    // An unavailable remote leaves the exact commit saved but undelivered.
    git(cwd, "remote", "add", "origin", join(cwd, "missing.git"));
    assert.notEqual((await runCli(["ship", "Document the helpful note"], { cwd })).code, 0);
    const saved = readSession(cwd);
    assert.equal(saved.status, "saved");
    await cli(cwd, "autonomy", "final-approval", "--instruction", "Ask before shipping");
    const result = await runCli(["ship", "--sync-only", "--json"], { cwd });
    assert.equal(result.code, 1);
    assert.match(result.json.operator, /withdrawn/);
    assert.equal(git(cwd, "rev-parse", "HEAD"), saved.savedCommit);
    assert.equal((await runCli(["abort"], { cwd })).code, 1);
  } finally { cleanup(cwd); }
});

test("deployment rejects dirty files and a switch out of autonomous mode", async () => {
  const cwd = await setup({ environment: "staging", cmd: 'node -e "process.exit(0)"', verifyCmd: 'node -e "process.exit(0)"', timeoutMs: 10000 });
  try {
    await build(cwd);
    await cli(cwd, "autonomy", "autonomous", "--instruction", "Handle delivery yourself");
    await finish(cwd);
    await cli(cwd, "ship", "Document the helpful note");
    writeFiles(cwd, { "README.md": "Unverified change\n" });
    let result = await runCli(["deploy", "--json"], { cwd });
    assert.equal(result.code, 1);
    assert.match(result.json.operator, /clean checkout/);
    writeFiles(cwd, { "README.md": "# Demo\n\nA helpful note.\n" });
    await cli(cwd, "autonomy", "final-approval", "--instruction", "Ask before deploying");
    result = await runCli(["deploy", "--json"], { cwd });
    assert.equal(result.code, 1);
    assert.match(result.json.operator, /withdrawn/);
    await cli(cwd, "deploy", "--approval-quote", "Deploy this revision to staging");
    assert.equal(readSession(cwd).status, "synced");
  } finally { cleanup(cwd); }
});

test("a request about stop controls does not pause work, while a direct stop does", async () => {
  const cwd = await setup();
  try {
    await build(cwd);
    decide("UserPromptSubmit", { prompt: "Add a stop button to the timer" }, cwd);
    assert.notEqual(readSession(cwd).autonomy.paused, true);
    decide("UserPromptSubmit", { prompt: "Stop, I need to check the scope" }, cwd);
    assert.equal(readSession(cwd).autonomy.paused, true);
    assert.equal((await runCli(["autonomy", "resume", "--instruction", "Stop, I need to check the scope"], { cwd })).code, 1);
  } finally { cleanup(cwd); }
});

test("plain withdrawal and deployment-specific stops are recognized without treating negated stops as pauses", () => {
  for (const text of ["No", "Nope.", "Please stop", "Don't deploy yet", "Do not push this"]) assert.equal(isInterruption(text), true, text);
  for (const text of ["Add a stop button", "Do not stop", "No changes needed"]) assert.equal(isInterruption(text), false, text);
});
