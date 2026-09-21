import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultConfig } from "./config.mjs";
import { classify, isProductSource } from "./paths.mjs";

test("documentable paths take precedence over fallback and explicit source globs", () => {
  const config = defaultConfig();
  assert.equal(classify(config, "scripts/check.mjs"), "other");
  assert.equal(isProductSource(config, "scripts/check.mjs"), false);
  assert.equal(isProductSource(config, "app.mjs"), true);

  config.paths.source = ["**/*"];
  assert.equal(classify(config, "scripts/check.mjs"), "other");
  assert.equal(isProductSource(config, "scripts/check.mjs"), false);
  assert.equal(isProductSource(config, "src/app.mjs"), true);
});
