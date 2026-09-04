import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { defaultConfig } from "./config.mjs";
import { parseUnifiedDiff } from "./diff.mjs";
import { applyLineRules } from "./rules.mjs";
import { FIXTURES } from "./test-helpers.mjs";

const diffsDir = join(FIXTURES, "diffs");

for (const file of readdirSync(diffsDir).filter((name) => name.endsWith(".diff"))) {
  const language = file.replace(/\.diff$/, "");
  test(`language rules: ${language}`, () => {
    const config = defaultConfig();
    config.paths.source = ["src/**", "app/**", "internal/**", "cmd/**"];
    config.paths.allowDebug = ["cmd/**"];
    const parsed = parseUnifiedDiff(readFileSync(join(diffsDir, file), "utf8"));
    const findings = applyLineRules(config, parsed);
    const expected = JSON.parse(readFileSync(join(diffsDir, `${language}.expected.json`), "utf8"));
    const actual = [...new Set(findings.map((finding) => finding.rule))].sort();
    assert.deepEqual(actual, [...expected].sort());
    for (const finding of findings) {
      assert.ok(finding.file && finding.line > 0, `finding has file:line: ${JSON.stringify(finding)}`);
    }
  });
}

test("debug rules skip test files and allowDebug paths; exceptions silence rules", () => {
  const config = defaultConfig();
  config.paths.source = ["src/**"];
  const parsed = parseUnifiedDiff(readFileSync(join(diffsDir, "typescript.diff"), "utf8"));
  const withException = applyLineRules(config, parsed, { exceptions: [{ rule: "debug-console", path: "src/**", reason: "The CLI prints its results" }] });
  assert.ok(!withException.some((finding) => finding.rule === "debug-console"));
  assert.ok(!applyLineRules(config, parsed).some((finding) => finding.file.startsWith("tests/") && finding.rule.startsWith("debug-")));
});

test("disabled rules are skipped", () => {
  const config = defaultConfig();
  config.rules.disable = ["unfinished-marker", "loose-any"];
  const parsed = parseUnifiedDiff(readFileSync(join(diffsDir, "typescript.diff"), "utf8"));
  const rules = new Set(applyLineRules(config, parsed).map((finding) => finding.rule));
  assert.ok(!rules.has("unfinished-marker"));
  assert.ok(!rules.has("loose-any"));
  assert.ok(rules.has("debug-console"));
});

test("diff parser reports new files and line numbers", () => {
  const parsed = parseUnifiedDiff(readFileSync(join(diffsDir, "python.diff"), "utf8"));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].file, "app/service.py");
  assert.equal(parsed[0].status, "M");
  assert.deepEqual(parsed[0].added.map((line) => line.line), [11, 12, 13, 14]);
});
