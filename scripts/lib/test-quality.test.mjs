import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultConfig } from "./config.mjs";
import { parseUnifiedDiff } from "./diff.mjs";
import { stagedDiff } from "./git.mjs";
import { checkTestQuality, testQualityFindings } from "./test-quality.mjs";
import { cleanup, git, makeTempRepo, writeFiles } from "./test-helpers.mjs";

const weak = "await expect(page.locator('html')).toHaveClass(/dark|light/);";

test("rejects whole-class comparisons and either-theme assertions with multiline locations", () => {
  const findings = testQualityFindings("view.spec.ts", [
    "await expect(button).toHaveAttribute(",
    "  'class', otherClass ?? ''",
    ");",
    weak,
    "await expect(page.locator('html')).toHaveClass(/light|dark/);",
  ].join("\n"));
  assert.deepEqual(findings.map(({ rule, line, endLine }) => ({ rule, line, endLine })), [
    { rule: "test-class-equality", line: 1, endLine: 3 },
    { rule: "test-theme-no-op", line: 4, endLine: 4 },
    { rule: "test-theme-no-op", line: 5, endLine: 5 },
  ]);
});

test("allows state, class presence, negative checks, unrelated calls, and quoted examples", () => {
  assert.deepEqual(testQualityFindings("view.test.tsx", [
    "await expect(button).toHaveAttribute('aria-pressed', 'true');",
    "await expect(button).toHaveAttribute('class');",
    "await expect(button).toHaveAttribute('class',);",
    "await expect(html).toHaveClass(/dark/);",
    "await expect(html).not.toHaveClass(/dark|light/);",
    "await expect(button).not.toHaveAttribute('class', oldClasses);",
    "await expect(dialog).toContainText('Delete this record?');",
    "helper.toHaveAttribute('class', expected);",
    "helper.expect(button).toHaveAttribute('class', expected);",
    `// ${weak}`,
    `/*\n${weak}\n*/`,
    `const example = ${JSON.stringify(weak)};`,
    "const exampleTemplate = `" + weak + "`;",
    "const escaped = 'it\\'s expect(button).toHaveAttribute(\"class\", expected)';",
  ].join("\n")), []);
});

test("uses staged content and added assertion ranges, respecting path selection and rule controls", () => {
  const dir = makeTempRepo({ files: { "tests/view.spec.ts": `${weak}\nconst untouched = 1;\n` } });
  const config = defaultConfig();
  try {
    const multiline = "await expect(button).toHaveAttribute(\n  'class', expected\n);\n";
    writeFiles(dir, {
      "tests/view.spec.ts": `${weak}\nconst changed = 2;\n${multiline}`,
      "src/view.ts": weak,
      "dist/view.test.ts": weak,
      "tests/readme.md": weak,
      ".agents/skills/demo/view.test.ts": weak,
      "custom/check.cjs": weak,
    });
    config.paths.tests.push("custom/**");
    git(dir, "add", ".");
    // A working-tree fix must not conceal the staged failure.
    writeFiles(dir, { "tests/view.spec.ts": "await expect(button).toHaveAttribute('aria-pressed', 'true');\n" });
    const parsed = parseUnifiedDiff(stagedDiff(dir));
    const findings = checkTestQuality(dir, config, parsed);
    assert.deepEqual(findings.map(({ rule, file, line }) => ({ rule, file, line })), [
      { rule: "test-theme-no-op", file: "custom/check.cjs", line: 1 },
      { rule: "test-class-equality", file: "tests/view.spec.ts", line: 3 },
    ]);
    config.rules.disable = ["test-theme-no-op"];
    assert.deepEqual(checkTestQuality(dir, config, parsed, { exceptions: [
      { rule: "test-class-equality", path: "tests/**", reason: "Legacy contract" },
    ] }), []);
  } finally {
    cleanup(dir);
  }
});

test("detects an argument-only edit inside an existing multiline assertion", () => {
  const dir = makeTempRepo({ files: { "view.test.ts": "await expect(button).toHaveAttribute(\n  'aria-pressed', expected\n);\n" } });
  try {
    writeFiles(dir, { "view.test.ts": "await expect(button).toHaveAttribute(\n  'class', expected\n);\n" });
    git(dir, "add", ".");
    const findings = checkTestQuality(dir, defaultConfig(), parseUnifiedDiff(stagedDiff(dir)));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "test-class-equality");
    assert.equal(findings[0].line, 1);
  } finally {
    cleanup(dir);
  }
});

test("all scope scans unchanged staged tests while changed scope remains upgrade-safe", () => {
  const dir = makeTempRepo({
    files: {
      "src/view.ts": "export const view = true;\n",
      "tests/legacy.spec.ts": `${weak}\n`,
    },
  });
  try {
    writeFiles(dir, { "src/view.ts": "export const view = false;\n" });
    git(dir, "add", ".");
    const config = defaultConfig();
    const parsed = parseUnifiedDiff(stagedDiff(dir));
    assert.deepEqual(checkTestQuality(dir, config, parsed), []);
    config.rules.testQuality.scope = "all";
    assert.deepEqual(checkTestQuality(dir, config, parsed).map(({ rule, file }) => ({ rule, file })), [
      { rule: "test-theme-no-op", file: "tests/legacy.spec.ts" },
    ]);
  } finally {
    cleanup(dir);
  }
});
