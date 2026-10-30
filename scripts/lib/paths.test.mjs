import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultConfig } from "./config.mjs";
import { classify, isProductSource, isVerificationDocumentation } from "./paths.mjs";

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

test("configured source and operational overlaps never become verification documentation", () => {
  const config = defaultConfig();
  config.paths.source = ["docs/source.md"];
  config.paths.documentable.push("docs/release.md");
  assert.equal(isVerificationDocumentation(config, "docs/source.md"), false);
  assert.equal(isVerificationDocumentation(config, "docs/release.md"), false);
  assert.equal(isVerificationDocumentation(config, "docs/guide.md"), true);
});

test("verification documentation excludes prose without exempting toolkit runtime or metadata", () => {
  const config = defaultConfig();
  for (const file of [
    "README.md",
    "docs/lifecycle.md",
  ]) assert.equal(isVerificationDocumentation(config, file), true, file);

  for (const file of [
    "AGENTS.md",
    "CLAUDE.md",
    ".agents/skills/solid/SKILL.md",
    ".agents/skills/solid/agents/openai.yaml",
    ".staff-engineer/templates/agents-block.md",
    "docs/security.md",
    "docs/development.md",
    ".github/workflows/README.md",
    "src/README.md",
    ".staff-engineer/cli.mjs",
    ".staff-engineer/lib/session.mjs",
    ".staff-engineer/config.json",
    ".staff-engineer/rules/ui.json",
    ".staff-engineer/VERSION",
    ".agents/skills/solid/.staff-engineer-owned",
    ".agents/skills/solid/rules/config.yaml",
    "docs/example.mjs",
    "docs/config.json",
    "docs/interactive.mdx",
  ]) assert.equal(isVerificationDocumentation(config, file), false, file);
});
