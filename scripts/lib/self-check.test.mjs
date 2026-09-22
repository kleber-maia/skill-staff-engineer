import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseCheck, selfCheckPlan } from "./self-check.mjs";
import { cleanup, commitAll, git, installInto, makeTempRepo, runCli } from "./test-helpers.mjs";

test("checks parse into probes tied to an acceptance check", () => {
  assert.deepEqual(parseCheck("2: page /orders contains Export", 2), { accept: 1, kind: "page", target: "/orders", text: "Export" });
  assert.deepEqual(parseCheck('1: run node demo.mjs contains "6"', 1), { accept: 0, kind: "run", target: "node demo.mjs", text: "6" });
  assert.throws(() => parseCheck("3: page / contains x", 2), /does not exist/);
  assert.throws(() => parseCheck("looks nice", 1), /not in a form/);
});

test("the self-check level decides what runs per lane", () => {
  assert.deepEqual(selfCheckPlan("off", "standard"), { probes: false, screenshots: false });
  assert.deepEqual(selfCheckPlan("auto", "trivial"), { probes: false, screenshots: false });
  assert.deepEqual(selfCheckPlan("auto", "large"), { probes: true, screenshots: false });
  assert.deepEqual(selfCheckPlan("thorough", "trivial"), { probes: true, screenshots: true });
});

test("preview runs probes itself, refuses on failure, and skips an unchanged rerun", async () => {
  const dir = makeTempRepo({ files: { "demo.mjs": "console.log(2 + 2);\n", "README.md": "# demo\n" } });
  try {
    await installInto(dir);
    await runCli(["config", "set", "preview", '{"kind":"manual","instructions":"Run the demo"}'], { cwd: dir });
    commitAll(dir, "install");
    await runCli(["begin", "Make the demo multiply"], { cwd: dir });
    await runCli(["brief", "--outcome", "The demo prints the product of two and three.", "--accept", "Run the demo and see 6", "--check", "1: run node demo.mjs contains 6"], { cwd: dir });
    await runCli(["context", "demo.mjs"], { cwd: dir });
    appendFileSync(join(dir, "README.md"), "Multiplies.\n");

    let result = await runCli(["preview", "--json"], { cwd: dir });
    assert.equal(result.code, 1, "a failing probe is caught before the operator looks");
    assert.match(result.json.errors.join("\n"), /Acceptance check 1: .*does not contain "6"/);

    writeFileSync(join(dir, "demo.mjs"), "console.log(2 * 3);\n");
    result = await runCli(["preview", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.json.agent, /1 automatic check passed/);

    await runCli(["revise"], { cwd: dir });
    result = await runCli(["preview", "--json"], { cwd: dir });
    assert.match(result.json.agent, /unchanged since the last passing run/, "nothing changed, so nothing reruns");

    await runCli(["revise"], { cwd: dir });
    await runCli(["settings", "set", "preview.selfCheck", "off"], { cwd: dir });
    writeFileSync(join(dir, "demo.mjs"), "console.log(1);\n");
    result = await runCli(["preview", "--json"], { cwd: dir });
    assert.equal(result.code, 0, "off skips probes entirely");
    assert.doesNotMatch(result.json.agent, /Self-check/);
    assert.equal(git(dir, "status", "--short").includes("settings"), false);
  } finally {
    cleanup(dir);
  }
});
