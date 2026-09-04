// Drives the whole lifecycle through the CLI in a temporary repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, commitAll, git, installInto, makeTempRepo, runCli, writeFiles } from "./test-helpers.mjs";

const PROJECT = {
  "package.json": JSON.stringify({ name: "demo", private: true, type: "module", scripts: { lint: "node -e \"process.exit(0)\"", test: "node --test tests/math.test.mjs", build: "node -e \"process.exit(0)\"" } }, null, 2),
  "src/math.mjs": "export const add = (a, b) => a + b;\n",
  "tests/math.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/math.mjs";\ntest("add", () => assert.equal(add(1, 2), 3));\n',
  "README.md": "# Demo\n",
};

async function setup() {
  const dir = makeTempRepo({ files: PROJECT });
  await installInto(dir);
  await runCli(["config", "set", "gates.format", "null"], { cwd: dir });
  await runCli(["config", "set", "preview", '{"kind":"manual","instructions":"Run the demo"}'], { cwd: dir });
  commitAll(dir, "Install toolkit");
  return dir;
}

test("full lifecycle: begin, brief, preview, finalize, lifecycle, verify, ship", async () => {
  const dir = await setup();
  try {
    let result = await runCli(["begin", "Add multiply", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);

    result = await runCli(["begin", "Another thing", "--json"], { cwd: dir });
    assert.equal(result.code, 1, "second begin is refused");

    result = await runCli(["preview", "--json"], { cwd: dir });
    assert.equal(result.code, 1, "preview needs a brief");

    result = await runCli(["brief", "--outcome", "People can multiply two numbers.", "--accept", "Run the demo and confirm 2 x 3 shows 6", "--non-goal", "Division", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);

    appendFileSync(join(dir, "src/math.mjs"), "export const mul = (a, b) => a * b;\n");

    result = await runCli(["verify", "--mode", "fast", "--json"], { cwd: dir });
    assert.equal(result.code, 1, "tests wait for feedback when source changed");

    result = await runCli(["finalize", "--json"], { cwd: dir, env: { STAFF_ENGINEER_PREVIEW_APPROVED: "1" } });
    assert.equal(result.code, 1, "finalize needs a presented preview");

    result = await runCli(["preview", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.json.operator, /2 x 3 shows 6/);
    assert.equal(result.json.data.round, 1);

    result = await runCli(["finalize", "--json"], { cwd: dir });
    assert.equal(result.code, 1, "finalize needs the approval flag");

    result = await runCli(["revise", "--json"], { cwd: dir });
    assert.equal(result.code, 0);
    result = await runCli(["preview", "--json"], { cwd: dir });
    assert.equal(result.json.data.round, 2);

    result = await runCli(["finalize", "--json"], { cwd: dir, env: { STAFF_ENGINEER_PREVIEW_APPROVED: "1" } });
    assert.equal(result.code, 0, result.stderr);

    appendFileSync(join(dir, "tests/math.test.mjs"), 'import { mul } from "../src/math.mjs";\ntest("mul", () => assert.equal(mul(2, 3), 6));\n');
    appendFileSync(join(dir, "src/math.mjs"), "console.log('debug');\n");
    git(dir, "add", "-A");

    result = await runCli(["lifecycle", "--json"], { cwd: dir });
    assert.equal(result.code, 3);
    const rules = result.json.data.blocking.map((finding) => finding.rule);
    assert.ok(rules.includes("debug-console"), rules.join());
    assert.ok(rules.includes("docs-impact"), rules.join());

    writeFileSync(join(dir, "src/math.mjs"), readFileSync(join(dir, "src/math.mjs"), "utf8").replace("console.log('debug');\n", ""));
    appendFileSync(join(dir, "README.md"), "- multiply\n");
    git(dir, "add", "-A");

    result = await runCli(["lifecycle", "--json"], { cwd: dir });
    assert.equal(result.code, 0, JSON.stringify(result.json?.errors));

    result = await runCli(["ship", "Add multiply to the demo", "--json"], { cwd: dir, env: { STAFF_ENGINEER_CHANGE_APPROVED: "1" } });
    assert.equal(result.code, 1, "ship needs a matching full receipt");

    result = await runCli(["verify", "--mode", "full", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.data.status, "passed");
    assert.ok(result.json.data.gates.some((gate) => gate.name === "format" && gate.status === "skipped"));

    result = await runCli(["handoff", "--json"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.match(result.json.operator, /automated tests/);
    assert.equal(result.json.data.receiptCurrent, true);

    // A docs-only edit after the full check keeps the receipt valid.
    appendFileSync(join(dir, "README.md"), "- docs tweak\n");
    git(dir, "add", "-A");

    result = await runCli(["ship", "Add multiply to the demo", "--json"], { cwd: dir });
    assert.equal(result.code, 1, "ship needs approval");

    result = await runCli(["ship", "Add multiply to the demo", "--json"], { cwd: dir, env: { STAFF_ENGINEER_CHANGE_APPROVED: "1" } });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.json.data.status, "synced", "no remote means synced immediately");
    const message = git(dir, "log", "-1", "--format=%B");
    assert.match(message, /^Add multiply to the demo/);
    assert.match(message, /Brief-Outcome: People can multiply two numbers\./);
    assert.equal(git(dir, "status", "--short"), "");

    result = await runCli(["begin", "Second concern", "--json"], { cwd: dir });
    assert.equal(result.code, 0, "a new concern can start after ship");
    result = await runCli(["abort", "--json"], { cwd: dir });
    assert.equal(result.code, 0);
  } finally {
    cleanup(dir);
  }
});

test("pre-existing dirty files are protected from the batch", async () => {
  const dir = await setup();
  try {
    writeFiles(dir, { "notes.md": "unrelated pending work\n" });
    let result = await runCli(["begin", "Protect baseline", "--json"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.deepEqual(result.json.data.baseline.files, ["notes.md"]);

    await runCli(["brief", "--outcome", "The demo greets people by name.", "--accept", "Run the demo and see a greeting"], { cwd: dir });
    writeFiles(dir, { "src/greet.mjs": "export const greet = (n) => `hi ${n}`;\n" });
    await runCli(["preview"], { cwd: dir });
    await runCli(["finalize"], { cwd: dir, env: { STAFF_ENGINEER_PREVIEW_APPROVED: "1" } });
    git(dir, "add", "-A"); // sweeps notes.md in

    result = await runCli(["lifecycle", "--json"], { cwd: dir });
    assert.equal(result.code, 3);
    assert.ok(result.json.data.blocking.some((finding) => finding.rule === "baseline-swept"));

    git(dir, "reset", "-q", "notes.md");
    writeFileSync(join(dir, "notes.md"), "changed after begin\n");
    result = await runCli(["status", "--json"], { cwd: dir });
    assert.equal(result.code, 0);
    result = await runCli(["preview", "--json"], { cwd: dir });
    assert.equal(result.code, 1, "changing a baseline file is refused");
    assert.match(result.json.operator, /already pending/);
  } finally {
    cleanup(dir);
  }
});

test("docs-only concerns may verify before feedback; waivers unblock the gate", async () => {
  const dir = await setup();
  try {
    await runCli(["begin", "Improve the readme"], { cwd: dir });
    await runCli(["brief", "--outcome", "The readme explains how to run the demo.", "--accept", "Read the readme and find the run instructions"], { cwd: dir });
    appendFileSync(join(dir, "README.md"), "Run it with node.\n");
    let result = await runCli(["verify", "--mode", "fast", "--json"], { cwd: dir });
    assert.equal(result.code, 0, "docs-only concern verifies before feedback");

    await runCli(["preview"], { cwd: dir });
    await runCli(["finalize"], { cwd: dir, env: { STAFF_ENGINEER_PREVIEW_APPROVED: "1" } });
    appendFileSync(join(dir, "src/math.mjs"), "export const sub = (a, b) => a - b;\n");
    git(dir, "add", "-A");
    result = await runCli(["lifecycle", "--json"], { cwd: dir });
    assert.equal(result.code, 3);
    assert.ok(result.json.data.blocking.some((finding) => finding.rule === "test-coverage"));
    result = await runCli(["lifecycle", "--json"], { cwd: dir, env: { STAFF_ENGINEER_TEST_WAIVER: "This helper is exercised by the existing demo tests." } });
    assert.equal(result.code, 0, JSON.stringify(result.json?.errors));
  } finally {
    cleanup(dir);
  }
});

test("verify reports the failing check with a focused excerpt", async () => {
  const dir = await setup();
  try {
    await runCli(["config", "set", "gates.lint.cmd", "node -e \"console.error('src/bad.mjs:12: unexpected token'); process.exit(1)\""], { cwd: dir });
    const result = await runCli(["verify", "--mode", "fast", "--json"], { cwd: dir });
    assert.equal(result.code, 3);
    assert.match(result.json.operator, /lint check failed/);
    assert.ok(result.json.data.report.locations.includes("src/bad.mjs:12"));
  } finally {
    cleanup(dir);
  }
});
