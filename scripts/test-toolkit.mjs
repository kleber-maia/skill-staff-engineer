#!/usr/bin/env node
// Expand test files ourselves: Node 20 and Windows shells do not expand globs.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tests = testFiles(join(root, "scripts")).sort();
if (!tests.length) throw new Error("No toolkit tests found.");

const result = spawnSync(process.execPath, ["--test", ...tests], { cwd: root, stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;

function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? testFiles(path) : entry.isFile() && entry.name.endsWith(".test.mjs") ? [path] : [];
  });
}
