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
  assert.deepEqual(config.updates, { revision: null, offline: "allow", timeoutMs: 60000 });
  assert.deepEqual(validateConfig(config), []);
});

test("update policy and affected-file placeholders are validated", () => {
  const config = defaultConfig();
  config.updates.offline = "sometimes";
  config.updates.timeoutMs = 10;
  config.gates.test = { cmd: "npm test", affected: 'npm test "{files}"' };
  const errors = validateConfig(config);
  assert.ok(errors.some((error) => /updates\.offline/.test(error)));
  assert.ok(errors.some((error) => /updates\.timeoutMs/.test(error)));
  assert.ok(errors.some((error) => /outside shell quotes/.test(error)));
});

test("test quality scope is validated", () => {
  const config = defaultConfig();
  config.rules.testQuality.scope = "repository";
  assert.ok(validateConfig(config).some((error) => /rules\.testQuality\.scope/.test(error)));
});
