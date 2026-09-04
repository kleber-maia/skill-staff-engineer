import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { detectStack } from "./detect.mjs";
import { FIXTURES } from "./test-helpers.mjs";

test("node project with npm lockfile, vitest, tsconfig", () => {
  const result = detectStack(join(FIXTURES, "node-npm"));
  assert.equal(result.packageManager, "npm");
  assert.ok(result.languages.includes("typescript"));
  assert.equal(result.gates.install.cmd, "npm ci");
  assert.equal(result.gates.lint.cmd, "npm run lint");
  assert.equal(result.gates.typecheck.cmd, "npm run typecheck");
  assert.equal(result.gates.test.cmd, "npm test");
  assert.equal(result.gates.test.affected, "npx vitest run {files}");
  assert.equal(result.gates.build.cmd, "npm run build");
  assert.equal(result.gates.format.cmd, "npx prettier --check .");
  assert.equal(result.preview.kind, "web");
  assert.equal(result.preview.url, "http://localhost:5173");
  assert.deepEqual(result.paths.source, ["src/**"]);
  assert.equal(result.questions.length, 0);
});

test("python project with uv, ruff, mypy, pytest, fastapi", () => {
  const result = detectStack(join(FIXTURES, "python-pyproject"));
  assert.deepEqual(result.languages, ["python"]);
  assert.equal(result.packageManager, "uv");
  assert.equal(result.gates.install.cmd, "uv sync");
  assert.equal(result.gates.format.cmd, "uv run ruff format --check .");
  assert.equal(result.gates.lint.cmd, "uv run ruff check .");
  assert.equal(result.gates.typecheck.cmd, "uv run mypy .");
  assert.equal(result.gates.test.cmd, "uv run pytest -q");
  assert.equal(result.preview.kind, "web");
  assert.ok(result.questions.some((question) => question.key === "preview.cmd"));
  assert.deepEqual(result.paths.source, ["app/**"]);
});

test("go module", () => {
  const result = detectStack(join(FIXTURES, "go-mod"));
  assert.deepEqual(result.languages, ["go"]);
  assert.equal(result.gates.test.cmd, "go test ./...");
  assert.equal(result.gates.format, null);
  assert.equal(result.preview.kind, "command");
  assert.equal(result.preview.cmd, "go run .");
});

test("static site: everything not applicable, preview needs confirmation", () => {
  const result = detectStack(join(FIXTURES, "static-html"));
  assert.equal(result.gates.test, null);
  assert.equal(result.gates.build, null);
  assert.equal(result.preview.kind, "web");
  assert.ok(result.questions.some((question) => question.key === "preview"));
});

test("empty project: every gate is an open question", () => {
  const result = detectStack(join(FIXTURES, "empty"));
  assert.deepEqual(result.gates, {});
  const keys = result.questions.map((question) => question.key);
  for (const name of ["install", "format", "lint", "typecheck", "test", "e2e", "build"]) assert.ok(keys.includes(`gates.${name}`), name);
  assert.ok(keys.includes("preview"));
});
