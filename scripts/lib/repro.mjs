// Bug fixes carry proof: a test from this change must fail on the original code
// and pass on the fixed code. The original code runs in a temporary git worktree
// at the session's base commit, with this change's test files copied in and the
// known ignored dependency directories copied into disposable storage.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";

import { output, runShell } from "./exec.mjs";
import { classify, isProtected, isNeverStage } from "./paths.mjs";
import { sessionConcernFiles } from "./session.mjs";

const TIMEOUT_MS = 5 * 60 * 1000;
const SETUP_FAILURE = /cannot find module|err_module_not_found|modulenotfounderror|no module named|command not found|is not recognized as an internal or external command|no such file or directory|enoent/i;

export function reproTestFiles(cwd, config, session) {
  return sessionConcernFiles(session, cwd).filter((file) => classify(config, file) === "tests");
}

// Returns { base: {ok, status, tail, setup}, now: {ok, status, tail} }.
export function runRepro(cwd, config, session, command) {
  const testFiles = reproTestFiles(cwd, config, session);
  const now = summarize(runShell(command, { cwd, timeoutMs: TIMEOUT_MS }));
  const base = withBaseWorktree(cwd, config, session.baseCommit, (dir) => {
    for (const file of testFiles) {
      const target = join(dir, file);
      if (existsSync(join(cwd, file))) {
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(cwd, file), target);
      } else {
        rmSync(target, { force: true });
      }
    }
    return summarize(runShell(command, { cwd: dir, timeoutMs: TIMEOUT_MS }));
  });
  base.setup = !base.ok && (base.status === 127 || SETUP_FAILURE.test(base.tail));
  return { base, now, testFiles };
}

function withBaseWorktree(cwd, config, commit, run) {
  const dir = mkdtempSync(join(tmpdir(), "staff-engineer-repro-"));
  output("git", ["worktree", "add", "--quiet", "--detach", dir, commit], { cwd });
  try {
    copyDependencies(cwd, dir, config);
    return run(dir);
  } finally {
    output("git", ["worktree", "remove", "--force", dir], { cwd, allowFailure: true });
    rmSync(dir, { recursive: true, force: true });
    output("git", ["worktree", "prune"], { cwd, allowFailure: true });
  }
}

// Only known dependency directories enter the base checkout. Copies are disposable:
// neither a test write nor an absolute/outside symlink can reach the original data.
function copyDependencies(cwd, dir, config) {
  for (const name of ["node_modules", ".venv", "venv", "vendor"]) {
    const source = join(cwd, name);
    if (!existsSync(source) || lstatSync(source).isSymbolicLink() || !lstatSync(source).isDirectory()) continue;
    if (!output("git", ["check-ignore", "--", name], { cwd, allowFailure: true })) continue;
    const canonicalSource = realpathSync.native(source);
    cpSync(source, join(dir, name), { recursive: true, dereference: true, filter: (path) => {
      const rel = relative(cwd, path).replaceAll("\\", "/");
      let canonical;
      try { canonical = realpathSync.native(path); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
      const target = relative(canonicalSource, canonical);
      return !target.startsWith("..") && !isAbsolute(target) && !isProtected(config, rel) && !isNeverStage(config, rel);
    } });
  }
}

function summarize(result) {
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n");
  return { ok: result.ok, status: result.status, timedOut: result.timedOut, tail: text };
}
