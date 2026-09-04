import { test } from "node:test";
import assert from "node:assert/strict";

import { validateReason, validateWaiver } from "./waivers.mjs";

test("broad-change reason needs length, words, and distinct words on one line", () => {
  assert.equal(validateReason("").ok, false);
  assert.equal(validateReason("too short").ok, false);
  assert.equal(validateReason("word word word word word word word word word word word word").ok, false, "not enough distinct words");
  assert.equal(validateReason("line one\nline two that is long enough to count as words").ok, false);
  const good = validateReason("The schema, the API handler, and the screen must change together or the feature is unusable.");
  assert.equal(good.ok, true);
  assert.ok(good.value.length >= 40);
});

test("waivers are optional but validated when present", () => {
  assert.equal(validateWaiver(undefined, "X").ok, false);
  assert.equal(validateWaiver("", "X").ok, false);
  assert.equal(validateWaiver("nope", "X").ok, false);
  assert.equal(validateWaiver("This wording change has no behavior to test.", "X").ok, true);
});
