import { test } from "node:test";
import assert from "node:assert/strict";

import { appendDecisions, parseDecision, readDecisions, relevantDecisions } from "./decisions.mjs";
import { cleanup, makeTempRepo } from "./test-helpers.mjs";

const session = (concern, brief) => ({ concern, brief: { outcome: "x", acceptance: ["y"], nonGoals: [], surfaces: [], decisions: [], ...brief } });

test("decisions parse as topic and choice", () => {
  assert.deepEqual(parseDecision("Export format: CSV"), { topic: "Export format", decision: "CSV" });
  assert.deepEqual(parseDecision("Keep dark mode"), { topic: "Keep dark mode", decision: "Keep dark mode" });
});

test("newer decisions supersede older ones on the same topic; only relevant ones come back", () => {
  const dir = makeTempRepo();
  try {
    assert.equal(appendDecisions(dir, session("Plain concern", {})), null, "nothing to record writes nothing");
    appendDecisions(dir, session("Export order history", { decisions: ["Export format: PDF"], nonGoals: ["Scheduled exports"], surfaces: ["Orders page"] }), { files: ["src/orders/export.ts"] });
    appendDecisions(dir, session("Export refunds too", { decisions: ["Export format: CSV"] }), { files: ["src/orders/refunds.ts"] });
    appendDecisions(dir, session("Change the login copy", { decisions: ["Login greeting: Welcome back"] }), { files: ["src/auth/login.ts"] });

    const all = readDecisions(dir);
    assert.equal(all.length, 4);
    assert.equal(all.find((entry) => entry.decision === "PDF").supersededBy, all.find((entry) => entry.decision === "CSV").id);

    const forExports = relevantDecisions(dir, { text: "Add a date range to the export" });
    assert.deepEqual(forExports.map((entry) => entry.decision).sort(), ["CSV", "Left out on purpose"]);
    assert.ok(!forExports.some((entry) => entry.decision === "PDF"), "superseded decisions are never shown");
    assert.ok(!forExports.some((entry) => entry.topic === "Login greeting"), "unrelated decisions stay out");

    const byFile = relevantDecisions(dir, { files: ["src/auth/login.ts"] });
    assert.equal(byFile[0].topic, "Login greeting");
    assert.deepEqual(relevantDecisions(dir, { text: "something unrelated entirely" }), []);
  } finally {
    cleanup(dir);
  }
});
