import { lstatSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { output, outputRaw } from "./exec.mjs";
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
  return nulPaths(outputRaw("git", ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRD", "--"], { cwd }));
}

export function unstagedFiles(cwd = process.cwd()) {
  const tracked = nulPaths(outputRaw("git", ["diff", "--name-only", "-z", "--"], { cwd }));
  const untracked = nulPaths(outputRaw("git", ["ls-files", "--others", "--exclude-standard", "-z", "--"], { cwd }));
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
  const fields = outputRaw("git", ["diff", "--cached", "--numstat", "-z", "--"], { cwd }).split("\0");
  const entries = [];
  for (let index = 0; index < fields.length - 1;) {
    const header = fields[index++];
    const first = header.indexOf("\t");
    const second = header.indexOf("\t", first + 1);
    if (first < 0 || second < 0) throw new Error("git diff --numstat returned an unexpected record");
    const added = header.slice(0, first);
    const deleted = header.slice(first + 1, second);
    let file = header.slice(second + 1);
    if (!file) {
      index += 1; // old path for a rename/copy
      file = fields[index++] ?? ""; // new path
    }
    entries.push({ file, added: added === "-" ? 0 : Number(added), deleted: deleted === "-" ? 0 : Number(deleted) });
  }
  return entries;
}

export function stagedBlobHash(file, cwd = process.cwd()) {
  const entries = nulPaths(outputRaw("git", ["--literal-pathspecs", "ls-files", "--stage", "-z", "--", file], { cwd }));
  if (!entries.length) return null; // a staged deletion has no index entry
  if (entries.length !== 1) throw new Error(`Unable to read one unambiguous staged entry for ${JSON.stringify(file)}`);
  const metadata = entries[0].slice(0, entries[0].indexOf("\t"));
  const parts = metadata.split(" ");
  if (parts.length < 3 || !/^[0-9a-f]+$/i.test(parts[1]) || parts[2] !== "0") throw new Error(`Unable to read the staged blob hash for ${JSON.stringify(file)}`);
  return parts[1];
}

// Fingerprint of a working-tree file as git would hash it (or "deleted").
export function workingTreeHash(file, cwd = process.cwd()) {
  try {
    lstatSync(resolve(cwd, file));
  } catch (error) {
    if (error?.code === "ENOENT") return "deleted";
    throw error;
  }
  return output("git", ["hash-object", "--", file], { cwd });
}

export function isTracked(file, cwd = process.cwd()) {
  return output("git", ["--literal-pathspecs", "ls-files", "--error-unmatch", "--", file], { cwd, allowFailure: true }) !== "";
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

export function nulPaths(value) {
  return value ? value.split("\0").slice(0, -1) : [];
}
