import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultConfig, mergeConfig, validateConfig } from "./config.mjs";

test("legacy configs inherit compatible lifecycle hardening defaults", () => {
  const config = mergeConfig(defaultConfig(), {
    version: 1,
    operator: { mode: "technical" },
    rules: { requireSession: "block" },
  });
  assert.equal(config.rules.testQuality.scope, "changed");
  assert.ok(config.paths.documentable.includes("scripts/**"));
  assert.deepEqual(validateConfig(config), []);
});

test("test quality scope is validated", () => {
  const config = defaultConfig();
  config.rules.testQuality.scope = "repository";
  assert.ok(validateConfig(config).some((error) => /rules\.testQuality\.scope/.test(error)));
});
