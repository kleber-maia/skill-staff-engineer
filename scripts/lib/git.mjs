import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { output } from "./exec.mjs";
import { tooling } from "./output.mjs";

export function isRepo(cwd = process.cwd()) {
  try {
    return output("git", ["rev-parse", "--is-inside-work-tree"], { cwd }) === "true";
  } catch {
    return false;
  }
}

export function repoRoot(cwd = process.cwd()) {
  try {
    return output("git", ["rev-parse", "--show-toplevel"], { cwd });
  } catch {
    throw tooling("This folder is not a git repository yet.", {
      agent: "Run `git init` (or `node .staff-engineer/cli.mjs install --init-git`) before using the lifecycle commands.",
    });
  }
}

// Directory inside .git (worktree-safe) where the toolkit keeps session state,
// receipts, and logs. Never committed, no .gitignore entry needed.
export function stateDir(cwd = process.cwd()) {
  const dir = resolve(cwd, output("git", ["rev-parse", "--git-path", "staff-engineer"], { cwd }));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function head(cwd = process.cwd()) {
  try {
    return output("git", ["rev-parse", "--verify", "HEAD"], { cwd });
  } catch {
    return null; // no commits yet
  }
}

export function currentBranch(cwd = process.cwd()) {
  try {
    return output("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  } catch {
    return null;
  }
}

export function stagedFiles(cwd = process.cwd()) {
  return lines(output("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRD", "--"], { cwd }));
}

export function unstagedFiles(cwd = process.cwd()) {
  const tracked = lines(output("git", ["diff", "--name-only", "--"], { cwd }));
  const untracked = lines(output("git", ["ls-files", "--others", "--exclude-standard", "--"], { cwd }));
  return [...new Set([...tracked, ...untracked])];
}

// All files that differ from HEAD in any way (staged, unstaged, untracked).
export function dirtyFiles(cwd = process.cwd()) {
  return [...new Set([...stagedFiles(cwd), ...unstagedFiles(cwd)])].sort();
}

export function stagedDiff(cwd = process.cwd()) {
  return output("git", ["diff", "--cached", "--unified=0", "--no-color", "--no-ext-diff", "--"], { cwd });
}

export function stagedNumstat(cwd = process.cwd()) {
  return lines(output("git", ["diff", "--cached", "--numstat", "--"], { cwd })).map((line) => {
    const [added, deleted, ...rest] = line.split("\t");
    return { file: rest.join("\t"), added: added === "-" ? 0 : Number(added), deleted: deleted === "-" ? 0 : Number(deleted) };
  });
}

export function stagedBlobHash(file, cwd = process.cwd()) {
  const entry = output("git", ["ls-files", "--stage", "--", file], { cwd });
  return entry.split(/\s+/)[1] ?? null;
}

// Fingerprint of a working-tree file as git would hash it (or "deleted").
export function workingTreeHash(file, cwd = process.cwd()) {
  try {
    return output("git", ["hash-object", "--", file], { cwd });
  } catch {
    return "deleted";
  }
}

export function isTracked(file, cwd = process.cwd()) {
  return output("git", ["ls-files", "--error-unmatch", "--", file], { cwd, allowFailure: true }) !== "";
}

export function commit(message, { cwd = process.cwd(), trailers = {} } = {}) {
  const args = ["commit", "--quiet", "-m", message];
  for (const [key, value] of Object.entries(trailers)) {
    if (value) args.push("--trailer", `${key}: ${value}`);
  }
  output("git", args, { cwd });
  return head(cwd);
}

export function push(cwd = process.cwd()) {
  const branch = currentBranch(cwd);
  const upstream = output("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd, allowFailure: true });
  if (upstream) {
    output("git", ["push", "--quiet"], { cwd });
  } else {
    output("git", ["push", "--quiet", "--set-upstream", "origin", branch], { cwd });
  }
}

export function hasUnpushedCommits(cwd = process.cwd()) {
  const upstream = output("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd, allowFailure: true });
  if (!upstream) return null; // no upstream configured
  return lines(output("git", ["log", "--oneline", "@{u}..HEAD"], { cwd })).length > 0;
}

export function lines(value) {
  return value ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}
