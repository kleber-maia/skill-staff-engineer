import { test } from "node:test";
import assert from "node:assert/strict";

import { checkApproval, readOperatorLog, recordOperatorMessage } from "./approval.mjs";
import { cleanup, makeTempRepo } from "./test-helpers.mjs";

test("without a harness log the operator's words are recorded as agent-reported", () => {
  const dir = makeTempRepo();
  try {
    assert.deepEqual(checkApproval(dir, "  Looks   good ", { purpose: "Finishing work" }), { quote: "Looks good", evidence: "agent-reported" });
    assert.throws(() => checkApproval(dir, "", { purpose: "Saving" }), /operator's own words/);
    assert.throws(() => checkApproval(dir, "can you move it left?", { purpose: "Saving" }), /question or a request to wait/);
    assert.throws(() => checkApproval(dir, "hold on, not yet", { purpose: "Saving" }), /question or a request to wait/);
  } finally {
    cleanup(dir);
  }
});

test("with a harness log the quote must match an operator message sent after the step", () => {
  const dir = makeTempRepo();
  try {
    recordOperatorMessage(dir, "Ship it!", { now: "2026-01-01T00:00:00.000Z" });
    recordOperatorMessage(dir, "Great work — ship it, thanks", { now: "2026-01-02T00:00:00.000Z" });
    const since = "2026-01-01T12:00:00.000Z";
    assert.deepEqual(checkApproval(dir, "ship it", { since, purpose: "Saving" }), { quote: "ship it", evidence: "operator-log" });
    assert.throws(() => checkApproval(dir, "looks perfect", { since, purpose: "Saving" }), /has not said "looks perfect"/);
    assert.throws(() => checkApproval(dir, "Ship it!", { since: "2026-01-03T00:00:00.000Z", purpose: "Saving" }), /has not said/, "earlier approval does not answer a later step");
  } finally {
    cleanup(dir);
  }
});

test("the operator log keeps only the most recent messages", () => {
  const dir = makeTempRepo();
  try {
    for (let index = 0; index < 25; index += 1) recordOperatorMessage(dir, `message ${index}`);
    recordOperatorMessage(dir, "   ");
    const log = readOperatorLog(dir);
    assert.equal(log.messages.length, 20);
    assert.equal(log.messages.at(-1).text, "message 24");
  } finally {
    cleanup(dir);
  }
});
