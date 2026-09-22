// Bug fixes carry proof: a test from this change must fail on the original code
// and pass on the fixed code. The original code runs in a temporary git worktree
// at the session's base commit, with this change's test files copied in and the
// project's ignored directories (installed dependencies) linked, so nothing in the
// working tree is touched.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { output, runShell } from "./exec.mjs";
import { classify } from "./paths.mjs";
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
  const base = withBaseWorktree(cwd, session.baseCommit, (dir) => {
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

function withBaseWorktree(cwd, commit, run) {
  const dir = mkdtempSync(join(tmpdir(), "staff-engineer-repro-"));
  output("git", ["worktree", "add", "--quiet", "--detach", dir, commit], { cwd });
  try {
    linkIgnored(cwd, dir);
    return run(dir);
  } finally {
    output("git", ["worktree", "remove", "--force", dir], { cwd, allowFailure: true });
    rmSync(dir, { recursive: true, force: true });
    output("git", ["worktree", "prune"], { cwd, allowFailure: true });
  }
}

// Installed dependencies and local tooling are ignored by git, so the base checkout
// lacks them; link them in so the test fails for the bug, not for missing setup.
function linkIgnored(cwd, dir) {
  const entries = output("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"], { cwd, allowFailure: true }).split("\n").filter(Boolean);
  for (const entry of entries) {
    const rel = entry.replace(/\/$/, "");
    if (!rel || rel.startsWith(".git") || rel.startsWith(".staff-engineer/backups")) continue;
    const target = join(dir, rel);
    if (existsSync(target) || !existsSync(dirname(target))) continue;
    try {
      symlinkSync(join(cwd, rel), target, entry.endsWith("/") ? "dir" : "file");
    } catch {
      // A missing link only risks a setup failure, which is reported as such.
    }
  }
}

function summarize(result) {
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n");
  return { ok: result.ok, status: result.status, timedOut: result.timedOut, tail: text };
}
