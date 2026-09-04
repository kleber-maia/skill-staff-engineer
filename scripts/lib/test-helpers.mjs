// Helpers for the toolkit's own tests: temp git repos and an in-process CLI runner.
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";

import { output } from "./exec.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURES = join(REPO_ROOT, "fixtures");

export function makeTempDir(prefix = "staff-engineer-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Creates a git repo with the given files committed. Returns its absolute path.
export function makeTempRepo({ files = {}, fixture = null, commit = true } = {}) {
  const dir = makeTempDir();
  if (fixture) cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  writeFiles(dir, files);
  output("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
  output("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  output("git", ["config", "user.name", "Test"], { cwd: dir });
  output("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  if (commit) commitAll(dir, "init");
  return dir;
}

export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
}

export function commitAll(dir, message) {
  output("git", ["add", "-A"], { cwd: dir });
  output("git", ["commit", "--quiet", "--allow-empty", "-m", message], { cwd: dir });
  return output("git", ["rev-parse", "HEAD"], { cwd: dir });
}

export function git(dir, ...args) {
  return output("git", args, { cwd: dir, allowFailure: true });
}

export function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// Runs the CLI in-process. Returns { code, stdout, stderr, json } where json is the
// parsed result when --json was passed.
export async function runCli(args, { cwd, env = {} } = {}) {
  const { main } = await import("../cli.mjs");
  const out = collector();
  const err = collector();
  const code = await main(args, { cwd, env: { ...process.env, ...env }, stdout: out.stream, stderr: err.stream });
  const stdout = out.text();
  const stderr = err.text();
  let json = null;
  if (args.includes("--json")) {
    const text = stdout.trim() || stderr.trim();
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { code, stdout, stderr, json };
}

function collector() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, text: () => chunks.join("") };
}

// Install the toolkit from this repository into a temp repo and commit it.
export async function installInto(dir, extraArgs = []) {
  const result = await runCli(["install", "--target", dir, "--yes", "--json", ...extraArgs], { cwd: dir });
  if (!result.json?.ok) throw new Error(`install failed: ${result.stdout}${result.stderr}`);
  return result.json;
}
