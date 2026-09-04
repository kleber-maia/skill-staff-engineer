import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanup, makeTempRepo } from "./test-helpers.mjs";
import { estimateSentence, readLedger, recordTimings, RETENTION, slownessWarnings, typicalDurations } from "./timings.mjs";

test("ledger records gates and totals, keeps medians, warns on slowdowns, and is capped", () => {
  const dir = makeTempRepo({ files: { "a.txt": "" } });
  try {
    for (const ms of [10_000, 12_000, 11_000]) {
      recordTimings(dir, "full", [{ name: "test", status: "passed", durationMs: ms }, { name: "lint", status: "passed", durationMs: 500 }], ms + 500);
    }
    const typical = typicalDurations(dir);
    assert.equal(typical.byGate.test, 11_000);
    assert.equal(typical.byGate.lint, 500);
    assert.equal(typical.byMode.full, 11_500);
    assert.equal(estimateSentence(typical, "full"), "The full check usually takes about 12s.");
    assert.equal(estimateSentence(typical, "fast"), null);

    const warnings = slownessWarnings([{ name: "test", status: "passed", durationMs: 20_000 }, { name: "lint", status: "passed", durationMs: 900 }], typical);
    assert.equal(warnings.length, 1, "lint is fast enough to ignore even when relatively slow");
    assert.match(warnings[0], /test took 20s, usually 11s/);

    for (let index = 0; index < RETENTION; index += 1) recordTimings(dir, "fast", [{ name: "lint", status: "passed", durationMs: 1 }], 1);
    assert.equal(readLedger(dir).length, RETENTION);
  } finally {
    cleanup(dir);
  }
});
