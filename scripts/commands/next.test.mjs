// Lanes and the next-step engine, driven through the CLI like an agent would.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, commitAll, git, installInto, makeTempRepo, runCli } from "../lib/test-helpers.mjs";

const PROJECT = {
  "package.json": JSON.stringify({ name: "demo", private: true, type: "module", scripts: { test: "node --test tests/copy.test.mjs" } }, null, 2),
  "src/copy.mjs": "export const title = \"Welcom\";\n",
  "tests/copy.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { title } from "../src/copy.mjs";\ntest("title", () => assert.ok(title));\n',
  "README.md": "# Demo\n",
};

async function setup() {
  const dir = makeTempRepo({ files: PROJECT });
  await installInto(dir);
  for (const gate of ["format", "lint", "typecheck", "build", "e2e"]) await runCli(["config", "set", `gates.${gate}`, "null"], { cwd: dir });
  await runCli(["config", "set", "gates.test", '{"cmd":"npm test"}'], { cwd: dir });
  await runCli(["config", "set", "preview", '{"kind":"manual","instructions":"Open the home page"}'], { cwd: dir });
  commitAll(dir, "Install toolkit");
  return dir;
}

const next = async (dir) => (await runCli(["next", "--json"], { cwd: dir })).json.data;

test("trivial lane: one operator touchpoint approves the preview and the save", async () => {
  const dir = await setup();
  try {
    assert.equal((await next(dir)).step, "begin");
    let result = await runCli(["begin", "Fix the title typo", "--lane", "trivial", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.data.lane, "trivial");
    assert.deepEqual((await next(dir)).skills, [], "trivial briefs skip the interview");

    await runCli(["brief", "--outcome", "The home page title is spelled correctly.", "--accept", "Open the home page and read Welcome"], { cwd: dir });
    writeFileSync(join(dir, "src/copy.mjs"), "export const title = \"Welcome\";\n");
    appendFileSync(join(dir, "tests/copy.test.mjs"), 'test("spelling", () => assert.equal(title, "Welcome"));\n');
    appendFileSync(join(dir, "README.md"), "The title reads Welcome.\n");
    assert.equal((await next(dir)).step, "build", "no context packet is needed in the trivial lane");

    result = await runCli(["preview", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.json.operator, /ship it/);
    assert.equal((await next(dir)).waitFor, "operator");

    result = await runCli(["finalize", "--approval-quote", "ship it", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.data.combinedApproval, true);
    git(dir, "add", "-A");
    assert.equal((await next(dir)).step, "check");

    result = await runCli(["lifecycle", "--json"], { cwd: dir });
    assert.equal(result.code, 0, JSON.stringify(result.json?.errors));
    result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal((await next(dir)).step, "ship");

    result = await runCli(["ship", "Fix the home page title typo", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const message = git(dir, "log", "-1", "--format=%B");
    assert.match(message, /Operator-Approval: ship it/);
  } finally {
    cleanup(dir);
  }
});

test("trivial lane: editing the source after approval needs another preview", async () => {
  const dir = await setup();
  try {
    await runCli(["begin", "Fix the title typo", "--lane", "trivial"], { cwd: dir });
    await runCli(["brief", "--outcome", "The home page title is spelled correctly.", "--accept", "Read Welcome"], { cwd: dir });
    writeFileSync(join(dir, "src/copy.mjs"), "export const title = \"Welcome\";\n");
    await runCli(["preview"], { cwd: dir });
    await runCli(["finalize", "--approval-quote", "ship it"], { cwd: dir });
    writeFileSync(join(dir, "src/copy.mjs"), "export const title = \"Welcome!\";\n");
    assert.equal((await next(dir)).step, "revise");
    const result = await runCli(["ship", "Fix the home page title typo", "--json"], { cwd: dir });
    assert.equal(result.code, 1);
    assert.match(result.json.errors.join(" ") + result.json.operator + result.json.agent, /revise/);
  } finally {
    cleanup(dir);
  }
});

test("trivial lane: work that outgrows the lane must move to standard", async () => {
  const dir = await setup();
  try {
    await runCli(["begin", "Rewrite the copy", "--lane", "trivial"], { cwd: dir });
    await runCli(["brief", "--outcome", "The home page copy is rewritten.", "--accept", "Read the new copy"], { cwd: dir });
    writeFileSync(join(dir, "src/copy.mjs"), Array.from({ length: 45 }, (_, index) => `export const line${index} = ${index};`).join("\n") + "\n");
    assert.equal((await next(dir)).step, "lane");
    let result = await runCli(["preview", "--json"], { cwd: dir });
    assert.equal(result.code, 1);
    assert.match(result.json.agent, /lane standard/);

    await runCli(["lane", "standard"], { cwd: dir });
    assert.equal((await next(dir)).step, "context", "standard work builds a context packet first");
  } finally {
    cleanup(dir);
  }
});

test("standard lane: saving needs a handoff of the verified batch, then the operator's words", async () => {
  const dir = await setup();
  try {
    await runCli(["begin", "Rename the title"], { cwd: dir });
    assert.deepEqual((await next(dir)).skills, ["grill-me"]);
    await runCli(["brief", "--outcome", "The home page greets people warmly.", "--accept", "Read Welcome"], { cwd: dir });
    await runCli(["context", "src/copy.mjs"], { cwd: dir });
    writeFileSync(join(dir, "src/copy.mjs"), "export const title = \"Welcome\";\n");
    appendFileSync(join(dir, "tests/copy.test.mjs"), 'test("spelling", () => assert.equal(title, "Welcome"));\n');
    await runCli(["preview"], { cwd: dir });
    await runCli(["finalize", "--approval-quote", "looks good"], { cwd: dir });
    appendFileSync(join(dir, "README.md"), "The title reads Welcome.\n");
    git(dir, "add", "-A");
    assert.equal((await next(dir)).step, "finish");
    await runCli(["verify", "--mode", "full"], { cwd: dir });
    assert.equal((await next(dir)).step, "handoff");

    let result = await runCli(["ship", "Rename the home page title", "--approval-quote", "looks good", "--json"], { cwd: dir });
    assert.equal(result.code, 1, "preview acceptance is not approval to save");
    assert.match(result.json.agent, /handoff/);

    await runCli(["handoff"], { cwd: dir });
    const waiting = await next(dir);
    assert.equal(waiting.step, "await-approval");
    assert.equal(waiting.waitFor, "operator");
    result = await runCli(["ship", "Rename the home page title", "--approval-quote", "ship it", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
  } finally {
    cleanup(dir);
  }
});

test("large lane: the first preview waits for an agreed plan", async () => {
  const dir = await setup();
  try {
    await runCli(["begin", "Redesign the home page", "--lane", "large"], { cwd: dir });
    await runCli(["brief", "--outcome", "The home page is redesigned.", "--accept", "Open the home page"], { cwd: dir });
    assert.equal((await next(dir)).step, "plan");
    writeFileSync(join(dir, "src/copy.mjs"), "export const title = \"Welcome\";\n");
    let result = await runCli(["preview", "--json"], { cwd: dir });
    assert.equal(result.code, 1);
    result = await runCli(["plan", "docs/missing.md", "--json"], { cwd: dir });
    assert.equal(result.code, 1);
    writeFileSync(join(dir, "PLAN.md"), "# Plan\n\n1. Redesign the header.\n");
    result = await runCli(["plan", "PLAN.md", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    assert.equal((await next(dir)).step, "context");
  } finally {
    cleanup(dir);
  }
});
