import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { summarizeRepro, hasBaseProof, REPRO_VERSION } from "../lib/repro.mjs";
import { readSession, writeSession } from "../lib/session.mjs";
import { reproIsCurrent } from "./repro.mjs";
import { loadConfig } from "../lib/config.mjs";
import { cleanup, commitAll, git, installInto, makeTempRepo, runCli, writeFiles } from "../lib/test-helpers.mjs";

const EXPECTED = "Widget gallery should show sample content";
const COMMAND = "node tests/gallery.check.mjs";
async function fixture(baselineDriver = 'console.log("FAIL: --capture-test needs a known StoreScreenshotCaptureTests method");\nconsole.log("padding\\n".repeat(35));\nprocess.exit(1);\n') {
  const cwd = makeTempRepo({ files: {
    "src/widget.mjs": 'export const widget = "update-message";\n',
    "scripts/driver.mjs": baselineDriver,
    "tests/gallery.check.mjs": 'import "../scripts/driver.mjs";\n',
    "README.md": "# Widget\n",
  } });
  await installInto(cwd);
  commitAll(cwd, "Install toolkit");
  await runCli(["begin", "Repair widget sample", "--bug"], { cwd });
  await runCli(["brief", "--outcome", "The gallery shows representative sample content.", "--accept", "See sample content in the gallery"], { cwd });
  writeFiles(cwd, {
    "src/widget.mjs": 'export const widget = "sample-content";\n',
    "tests/gallery.check.mjs": 'import "../scripts/driver.mjs";\n// This capture method is new in the test driver.\n',
    "scripts/driver.mjs": `import assert from "node:assert/strict";
import {existsSync,realpathSync} from "node:fs";
import {resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {widget} from "../src/widget.mjs";
if(widget!=="sample-content") {
  assert.equal(existsSync(${JSON.stringify(join(cwd, ".git/worktrees"))}),false,"No transient worktree registration is allowed");
  const common=resolve(execFileSync("git",["rev-parse","--git-common-dir"],{encoding:"utf8"}).trim());
  assert.notEqual(realpathSync(common),realpathSync(${JSON.stringify(join(cwd, ".git"))}),"Baseline Git state must be independent");
  assert.equal(execFileSync("git",["remote"],{encoding:"utf8"}).trim(),"","Baseline has no push destination");
}
assert.equal(widget,"sample-content",${JSON.stringify(EXPECTED)});
`,
  });
  return cwd;
}
const run = (cwd, ...extra) => runCli(["repro", COMMAND, "--expect-failure", EXPECTED, ...extra, "--json"], { cwd });

test("the reported unknown wrapper method is setup failure even outside the displayed tail", async () => {
  const cwd = await fixture();
  try {
    const result = await run(cwd);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.json.operator, /setup reason/);
    assert.equal(result.json.data.base.setup, true);
    assert.equal(result.json.data.base.expectedFailureMatched, false);
    assert.doesNotMatch(result.json.data.base.tail, /capture-test/, "classification inspected more than the last 25 lines");
    assert.equal(hasBaseProof(readSession(cwd).repro), false);
    assert.equal((await runCli(["next", "--json"], { cwd })).json.data.step, "repro");
    assert.equal((await runCli(["preview", "--json"], { cwd })).code, 1);
  } finally { cleanup(cwd); }
});

test("an unrelated nonzero baseline failure is not accepted as the expected product assertion", async () => {
  const cwd = await fixture('console.error("An unrelated baseline assertion failed"); process.exit(1);\n');
  try {
    const result = await run(cwd);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.json.operator, /does not match/);
    assert.equal(result.json.data.base.setup, false);
    assert.equal(result.json.data.base.expectedFailureMatched, false);
    assert.equal(hasBaseProof(readSession(cwd).repro), false);
  } finally { cleanup(cwd); }
});

test("explicit changed drivers permit genuine proof without copying the product fix or using worktrees", async () => {
  const cwd = await fixture();
  try {
    const before = readFileSync(join(cwd, ".git/index"));
    const staged = git(cwd, "diff", "--cached", "--binary");
    const routing = { GIT_DIR: join(cwd, ".git"), GIT_WORK_TREE: cwd, GIT_INDEX_FILE: join(cwd, ".git/index") };
    const saved = Object.fromEntries(Object.keys(routing).map((key) => [key, process.env[key]]));
    let result;
    try {
      Object.assign(process.env, routing);
      result = await run(cwd, "--support-file", "scripts/driver.mjs", "--timeout-ms", "120000");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const repro = readSession(cwd).repro;
    assert.equal(repro.version, REPRO_VERSION);
    assert.equal(repro.failsAtBase, true);
    assert.equal(repro.passesNow, true);
    assert.equal(repro.expectedFailure, EXPECTED);
    assert.deepEqual(repro.supportFiles, ["scripts/driver.mjs"]);
    assert.equal(repro.timeoutMs, 120000);
    assert.equal(repro.isolation, "independent-repository");
    assert.equal(hasBaseProof(repro), true);
    assert.equal(reproIsCurrent(cwd, loadConfig(cwd), readSession(cwd)), true);
    assert.deepEqual(readFileSync(join(cwd, ".git/index")), before);
    assert.equal(git(cwd, "diff", "--cached", "--binary"), staged);
    assert.equal(existsSync(join(cwd, ".git/worktrees")), false);
  } finally { cleanup(cwd); }
});

test("unrelated current failures and interrupted runs cannot retain a previous successful proof", async () => {
  const cwd = await fixture();
  try {
    assert.equal((await run(cwd, "--support-file", "scripts/driver.mjs")).code, 0);
    const valid = readSession(cwd);
    for (const command of ['node -e "console.error(\'unrelated failure\');process.exit(1)"', `node -e "console.error('${EXPECTED}');process.exit(130)"`]) {
      writeSession(cwd, valid);
      const result = await runCli(["repro", command, "--expect-failure", EXPECTED, "--json"], { cwd });
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.equal(hasBaseProof(readSession(cwd).repro), false);
      assert.equal(reproIsCurrent(cwd, loadConfig(cwd), readSession(cwd)), false);
    }
  } finally { cleanup(cwd); }
});

test("legacy success booleans cannot authorize preview or final save under the corrected protocol", async () => {
  const cwd = await fixture();
  try {
    const s = readSession(cwd);
    writeSession(cwd, { ...s, repro: { command: COMMAND, failsAtBase: true, passesNow: true, baseTail: "FAIL: --capture-test needs a known StoreScreenshotCaptureTests method" } });
    assert.equal((await runCli(["next", "--json"], { cwd })).json.data.step, "repro");
    assert.equal((await runCli(["preview", "--json"], { cwd })).code, 1);
    assert.equal(reproIsCurrent(cwd, loadConfig(cwd), readSession(cwd)), false);
  } finally { cleanup(cwd); }
});

test("product files, unchanged drivers, toolkit code and invalid budgets are rejected before execution", async () => {
  const cwd = await fixture();
  try {
    for (const extra of [[], ["--support-file", "src/widget.mjs"], ["--support-file", "../outside.mjs"], ["--support-file", ".staff-engineer/cli.mjs"], ["--timeout-ms", "0"], ["--timeout-ms", "3600001"]]) {
      const args = extra.length ? ["repro", COMMAND, "--expect-failure", EXPECTED, ...extra, "--json"] : ["repro", COMMAND, "--json"];
      const result = await runCli(args, { cwd });
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.equal(readSession(cwd).repro, undefined, "invalid options never launched a command");
    }
    git(cwd, "checkout", "HEAD", "--", "scripts/driver.mjs");
    assert.equal((await run(cwd, "--support-file", "scripts/driver.mjs")).code, 1);
  } finally { cleanup(cwd); }
});

test("timeouts, execution errors and signals cannot become matching failures, while full-output assertions can", () => {
  const failed = { ok: false, status: 1, stdout: EXPECTED + "\n" + "padding\n".repeat(40), stderr: "", timedOut: false };
  const ordinary = summarizeRepro(failed, EXPECTED);
  assert.equal(ordinary.expectedFailureMatched, true);
  assert.equal(ordinary.setup, false);
  assert.doesNotMatch(ordinary.tail, /Widget gallery/);
  for (const interrupted of [ { timedOut: true, status: null }, { error: "spawn failed", status: null }, { status: null }, { status: 130 }, { status: 143 } ]) {
    const actual = summarizeRepro({ ...failed, ...interrupted }, EXPECTED);
    assert.equal(actual.incomplete, true);
    assert.equal(actual.expectedFailureMatched, false);
  }
  assert.equal(summarizeRepro({ ...failed, stdout: "Unknown option --capture-test\n" + EXPECTED }, EXPECTED).setup, true);
});
