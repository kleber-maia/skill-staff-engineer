import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { defaultConfig } from "./config.mjs";
import { parseUnifiedDiff } from "./diff.mjs";
import { FIXTURES } from "./test-helpers.mjs";
import { applyUiRules, isUiFile } from "./ui-rules.mjs";

const parsed = () => parseUnifiedDiff(readFileSync(join(FIXTURES, "diffs", "ui.diff"), "utf8"));

test("UI rules fire on component and style files with the expected ids", () => {
  const config = defaultConfig();
  config.paths.source = ["src/**"];
  const findings = applyUiRules(config, parsed());
  const expected = JSON.parse(readFileSync(join(FIXTURES, "diffs", "ui.expected.json"), "utf8"));
  assert.deepEqual([...new Set(findings.map((finding) => finding.rule))].sort(), expected.sort());
  const cssRaw = findings.filter((finding) => finding.rule === "ui-raw-color-css");
  assert.equal(cssRaw.length, 1, "token definitions are not flagged, plain declarations are");
  assert.equal(cssRaw[0].line, 3);
  assert.ok(findings.every((finding) => finding.file && finding.line > 0));
});

test("UI rules can be disabled and excepted", () => {
  const config = defaultConfig();
  config.rules.ui = { enabled: false };
  assert.deepEqual(applyUiRules(config, parsed()), []);
  const enabled = defaultConfig();
  const findings = applyUiRules(enabled, parsed(), { exceptions: [{ rule: "ui-browser-dialog", path: "src/features/**", reason: "Legacy confirm kept until the dialog component lands" }] });
  assert.ok(!findings.some((finding) => finding.rule === "ui-browser-dialog"));
});

test("only user-facing file types are UI files", () => {
  assert.ok(isUiFile("src/App.tsx"));
  assert.ok(isUiFile("public/index.html"));
  assert.ok(isUiFile("styles/main.scss"));
  assert.ok(!isUiFile("src/server.ts"));
  assert.ok(!isUiFile("app/models.py"));
});
