import { test } from "node:test";
import assert from "node:assert/strict";

import { writeJson } from "./fs-safe.mjs";
import { historyPath, readHistory } from "./history.mjs";
import { agentInsights, findAgentInsights, findOperatorInsight, operatorInsight, summarize } from "./insights.mjs";
import { cleanup, commitAll, git, installInto, makeTempRepo, runCli, writeFiles } from "./test-helpers.mjs";

const done = (overrides = {}) => ({ concern: "A change", outcome: "saved", lane: "standard", initialLane: "standard", reviewRounds: 1, probes: 0, waivers: [], gateBlocks: {}, commit: null, ...overrides });

test("small samples stay quiet; repeated patterns become agent guidance", () => {
  assert.deepEqual(findAgentInsights([done({ reviewRounds: 4 }), done({ reviewRounds: 4 })]), [], "too few concerns to judge");

  const slow = Array.from({ length: 6 }, () => done({ reviewRounds: 3, waivers: ["Test-Waiver"], gateBlocks: { "debug-console": 1 } }));
  const ids = findAgentInsights(slow, { webPreview: true }).map((insight) => insight.id);
  assert.deepEqual(ids.sort(), ["gate:debug-console", "probes-unused", "review-rounds", "waiver:Test-Waiver"]);
  assert.ok(!findAgentInsights(slow, { webPreview: true, selfCheck: "off" }).some((insight) => insight.id === "probes-unused"), "no probe advice when self-check is off");

  const trivialMisses = [done({ initialLane: "trivial", lane: "standard" }), done({ initialLane: "trivial", lane: "standard" }), done({ initialLane: "trivial", lane: "trivial" })];
  assert.ok(findAgentInsights(trivialMisses).some((insight) => insight.id === "lane-trivial"));

  const reverted = findAgentInsights([done({ concern: "Export orders", commit: "abc1234" })], { reverted: ["abc1234"] });
  assert.match(reverted[0].message, /"Export orders" was reverted/);
});

test("the operator hears only a milestone every tenth saved change", () => {
  assert.equal(findOperatorInsight(Array.from({ length: 9 }, () => done())), null);
  const history = [...Array.from({ length: 10 }, () => done({ reviewRounds: 3 })), ...Array.from({ length: 10 }, (_, index) => done({ reviewRounds: index < 8 ? 1 : 2 }))];
  const insight = findOperatorInsight(history);
  assert.match(insight.message, /20 changes saved this way; 8 of the last 10 were right the first time you looked, fewer rounds/);
  assert.doesNotMatch(insight.message, /review|commit|lane|gate/i, "plain language only");
});

test("an insight is shown once until its finding changes", () => {
  const dir = makeTempRepo();
  try {
    writeJson(historyPath(dir), { version: 1, concerns: Array.from({ length: 6 }, () => done({ reviewRounds: 3 })) });
    const now = Date.parse("2026-01-01T00:00:00Z");
    assert.equal(agentInsights(dir, {}, { now }).length, 1);
    assert.equal(agentInsights(dir, {}, { now: now + 30 * 86400000 }).length, 0, "same finding is not repeated");
    writeJson(historyPath(dir), { version: 1, concerns: Array.from({ length: 6 }, () => done({ reviewRounds: 4 })) });
    assert.equal(agentInsights(dir, {}, { now: now + 1 * 86400000 }).length, 0, "a changed finding waits out the repeat window");
    assert.equal(agentInsights(dir, {}, { now: now + 15 * 86400000 }).length, 1);
    assert.equal(summarize(readHistory(dir)).averageRounds, 4);
  } finally {
    cleanup(dir);
  }
});

test("finished and abandoned concerns are recorded locally and surface at the next begin", async () => {
  const dir = makeTempRepo({ files: { "README.md": "# demo\n" } });
  try {
    await installInto(dir);
    for (const gate of ["install", "format", "lint", "typecheck", "test", "build", "e2e"]) await runCli(["config", "set", `gates.${gate}`, "null"], { cwd: dir });
    await runCli(["config", "set", "preview", '{"kind":"manual","instructions":"Read it"}'], { cwd: dir });
    commitAll(dir, "install");

    await runCli(["begin", "Abandoned idea here"], { cwd: dir });
    await runCli(["abort"], { cwd: dir });
    for (let index = 0; index < 5; index += 1) {
      await runCli(["begin", `Readme note number ${index}`, "--lane", "trivial"], { cwd: dir });
      await runCli(["brief", "--outcome", "The readme gains one more note.", "--accept", "Read the new note"], { cwd: dir });
      writeFiles(dir, { "README.md": `# demo\n\nNote ${index}.\n` });
      await runCli(["preview"], { cwd: dir });
      await runCli(["finalize", "--approval-quote", "ship it"], { cwd: dir });
      git(dir, "add", "-A");
      await runCli(["verify", "--mode", "full"], { cwd: dir });
      const result = await runCli(["ship", `Add readme note ${index}`, "--json"], { cwd: dir });
      assert.equal(result.code, 0, result.stderr || result.stdout);
    }
    const history = readHistory(dir);
    assert.deepEqual(history.map((entry) => entry.outcome), ["aborted", "saved", "saved", "saved", "saved", "saved"]);
    assert.equal(history.at(-1).approvalEvidence, "agent-reported");
    assert.equal(git(dir, "status", "--short"), "", "history never shows up as a project change");

    const stats = await runCli(["stats", "--json"], { cwd: dir });
    assert.equal(stats.json.data.saved, 5);
    assert.equal(stats.json.data.firstLookRate, 1);
    assert.equal(operatorInsight(dir), null, "no milestone before the tenth save");
  } finally {
    cleanup(dir);
  }
});
