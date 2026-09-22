import { test } from "node:test";
import assert from "node:assert/strict";

import { validateAffectedCommandTemplate } from "./command-template.mjs";

test("affected command templates accept one top-level filename token", () => {
  for (const template of [
    "npm test -- {files}",
    "npx jest --findRelatedTests {files}",
    "npx vitest run {files}",
    "pytest -q {files}",
    "node -e 'console.log(JSON.stringify(process.argv.slice(1)))' {files}",
  ]) assert.deepEqual(validateAffectedCommandTemplate(template), { ok: true, error: null }, template);
});

test("affected command templates reject quoted, embedded, commented, duplicate, and shell-evaluated placeholders", () => {
  for (const template of [
    'sh -c "echo {files} "',
    'sh -c "echo " {files}',
    "bash -lc {files}",
    "pwsh -Command {files}",
    "cmd /c {files}",
    String.raw`C:\Windows\System32\cmd.exe /c {files}`,
    "env sh -c 'echo safe' {files}",
    "eval {files}",
    "command eval {files}",
    "call {files}",
    "\${RUNNER} {files}",
    "%RUNNER% {files}",
    "echo \\ {files}",
    "echo $(printf safe {files})",
    "pytest -q --files={files}",
    "pytest -q '{files}'",
    "pytest -q # {files}",
    "pytest {files} {files}",
  ]) assert.equal(validateAffectedCommandTemplate(template).ok, false, template);
});
