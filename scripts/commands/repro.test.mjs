import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, commitAll, git, installInto, makeTempRepo, runCli, writeFiles } from "../lib/test-helpers.mjs";

const PROJECT = {
  "package.json": JSON.stringify({ name: "demo", private: true, type: "module" }),
  "src/cart.mjs": "export const total = (items) => items.reduce((sum, item) => sum + item, 1);\n",
  // Plain node scripts: a nested "node --test" inside this test runner reports to the parent and always exits 0.
  "tests/cart.check.mjs": 'import assert from "node:assert/strict";\nimport { total } from "../src/cart.mjs";\nassert.ok(total([1]));\n',
  "README.md": "# Demo\n",
};
const REPRO = "node tests/cart.check.mjs";

async function bugSession() {
  const dir = makeTempRepo({ files: PROJECT });
  await installInto(dir);
  for (const gate of ["install", "format", "lint", "typecheck", "build", "e2e"]) await runCli(["config", "set", `gates.${gate}`, "null"], { cwd: dir });
  await runCli(["config", "set", "gates.test", `{"cmd":"${REPRO}"}`], { cwd: dir });
  await runCli(["config", "set", "preview", '{"kind":"manual","instructions":"Open the cart"}'], { cwd: dir });
  commitAll(dir, "install");
  await runCli(["begin", "Cart total is off by one", "--lane", "trivial", "--bug"], { cwd: dir });
  await runCli(["brief", "--outcome", "The cart total equals the sum of the items.", "--accept", "Add items worth 2 and 3 and see 5"], { cwd: dir });
  return dir;
}

test("a bug fix is proven by a test that fails before and passes after", async () => {
  const dir = await bugSession();
  try {
    const next = async () => (await runCli(["next", "--json"], { cwd: dir })).json.data.step;
    assert.equal(await next(), "repro");
    assert.equal((await runCli(["repro", REPRO, "--json"], { cwd: dir })).code, 1, "the reproduction must be a test in this change");

    appendFileSync(join(dir, "tests/cart.check.mjs"), "assert.equal(total([2, 3]), 5);\n");
    let result = await runCli(["repro", REPRO, "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.data.repro.passesNow, false);
    assert.match(result.json.agent, /Reproduction confirmed/);

    writeFileSync(join(dir, "src/cart.mjs"), "export const total = (items) => items.reduce((sum, item) => sum + item, 0);\n");
    result = await runCli(["repro", REPRO, "--json"], { cwd: dir });
    assert.equal(result.json.data.repro.passesNow, true);
    assert.match(result.json.agent, /Proof complete/);
    assert.equal(git(dir, "worktree", "list").split("\n").length, 1, "the temporary worktree is removed");

    appendFileSync(join(dir, "README.md"), "Totals start at zero.\n");
    await runCli(["review"], { cwd: dir });
    await runCli(["review", "done", "--found", "0", "--fixed", "0"], { cwd: dir });
    await runCli(["preview"], { cwd: dir });
    await runCli(["finalize", "--approval-quote", "ship it"], { cwd: dir });
    git(dir, "add", "-A");
    await runCli(["verify", "--mode", "full"], { cwd: dir });
    result = await runCli(["ship", "Fix the off-by-one cart total", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(git(dir, "log", "-1", "--format=%B"), /Repro: node tests\/cart\.check\.mjs \(fails before the fix, passes after\)/);
  } finally {
    cleanup(dir);
  }
});

test("a test that already passes on the original code proves nothing", async () => {
  const dir = await bugSession();
  try {
    appendFileSync(join(dir, "tests/cart.check.mjs"), "assert.ok(total([]) >= 0);\n");
    const result = await runCli(["repro", REPRO, "--json"], { cwd: dir });
    assert.equal(result.code, 1);
    assert.match(result.json.operator, /passes on the original code/);
    assert.equal((await runCli(["preview", "--json"], { cwd: dir })).code, 1, "no preview without proof");
  } finally {
    cleanup(dir);
  }
});

test("a failure caused by missing setup is not accepted as proof", async () => {
  const dir = await bugSession();
  try {
    writeFiles(dir, { "tests/new.check.mjs": 'import "../src/helper-that-does-not-exist-yet.mjs";\n', "src/helper-that-does-not-exist-yet.mjs": "export {};\n" });
    const result = await runCli(["repro", "node tests/new.check.mjs", "--json"], { cwd: dir });
    assert.equal(result.code, 1);
    assert.match(result.json.operator, /setup reason/);
  } finally {
    cleanup(dir);
  }
});
