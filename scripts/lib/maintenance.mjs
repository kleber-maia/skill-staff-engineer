// Toolkit maintenance (install, update, uninstall) is not a concern: it never runs
// the lifecycle, and it is saved as its own commit touching only toolkit-owned paths.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadConfig, TOOLKIT_DIR } from "./config.mjs";
import { output, outputRaw } from "./exec.mjs";
import { acquireSaveLock, readJson, writeJson } from "./fs-safe.mjs";
import { dirtyFiles, head, stagedEntry, stateDir } from "./git.mjs";
import { HASH, HTML, markers, removeBlock, upsertBlock } from "./managed-block.mjs";
import { refused } from "./output.mjs";
import { commitMatches, deliver, shippingTarget } from "./shipping.mjs";

const SHARED = new Set(["AGENTS.md", "CLAUDE.md", ".gitignore", ".claude/settings.json"]);

function committedText(cwd, file) {
  const hash = output("git", ["rev-parse", "--verify", `HEAD:${file}`], { cwd, allowFailure: true });
  return hash ? outputRaw("git", ["cat-file", "blob", hash], { cwd }) : null;
}

// Project only the toolkit's part onto a supplied version of a shared file.
// The caller's other text/settings never become part of the maintenance commit.
function ownedText(file, base, working) {
  if (file === ".claude/settings.json") {
    const original = base ? JSON.parse(base) : {};
    const changed = working ? JSON.parse(working) : {};
    const ours = (entry) => JSON.stringify(entry).includes(`${TOOLKIT_DIR}/hooks/`);
    const result = structuredClone(original);
    for (const event of new Set([...Object.keys(original.hooks ?? {}), ...Object.keys(changed.hooks ?? {})])) {
      const entries = [...(original.hooks?.[event] ?? []).filter((entry) => !ours(entry)), ...(changed.hooks?.[event] ?? []).filter(ours)];
      result.hooks ??= {};
      if (entries.length) result.hooks[event] = entries;
      else delete result.hooks[event];
    }
    if (result.hooks && !Object.keys(result.hooks).length) delete result.hooks;
    if (JSON.stringify(result) === JSON.stringify(original)) return base;
    return Object.keys(result).length ? `${JSON.stringify(result, null, 2)}\n` : null;
  }
  const style = file === ".gitignore" ? HASH : HTML;
  const { start, end } = markers("staff-engineer", style);
  const startAt = working?.indexOf(start) ?? -1;
  const endAt = working?.indexOf(end) ?? -1;
  if (startAt >= 0 && endAt > startAt) return upsertBlock(base, "staff-engineer", working.slice(startAt + start.length, endAt), style).text;
  if (file === "CLAUDE.md" && /^@AGENTS\.md\s*$/m.test(working ?? "")) {
    if (/^@AGENTS\.md\s*$/m.test(base ?? "")) return base;
    if (base === null) return "@AGENTS.md\n";
    return upsertBlock(base, "staff-engineer", "@AGENTS.md", HTML).text;
  }
  const text = removeBlock(base ?? "", "staff-engineer", style).text;
  return text || null;
}

function workingText(cwd, file) {
  return existsSync(resolve(cwd, file)) ? readFileSync(resolve(cwd, file), "utf8") : null;
}

// Every path an install or upgrade may own; sourceDir adds skills new in that version.
export function toolkitPaths(cwd, sourceDir = null) {
  const installedSkills = readJson(resolve(cwd, TOOLKIT_DIR, "skills.json"), null)?.skills ?? [];
  const sourceSkillsDir = sourceDir ? resolve(sourceDir, "skills") : null;
  const sourceSkills = sourceSkillsDir && existsSync(sourceSkillsDir)
    ? readdirSync(sourceSkillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  return [
    TOOLKIT_DIR,
    ...[...new Set([...installedSkills, ...sourceSkills])].map((name) => `.agents/skills/${name}`),
    "AGENTS.md",
    "CLAUDE.md",
    ".gitignore",
    ".claude/settings.json",
  ];
}

export function pendingToolkitFiles(cwd) {
  const targets = toolkitPaths(cwd);
  return dirtyFiles(cwd).filter((file) => {
    if (!targets.some((target) => file === target || file.startsWith(`${target}/`))) return false;
    if (!SHARED.has(file)) return true;
    const before = committedText(cwd, file);
    return ownedText(file, before, workingText(cwd, file)) !== before;
  });
}

// Commits only the pending toolkit-owned files, leaving anything else staged or dirty
// untouched. Returns null when there is nothing to save; throws when git refuses.
export function saveToolkit(cwd, message, trailers = {}) {
  const release = acquireSaveLock(stateDir(cwd));
  try { return saveToolkitUnlocked(cwd, message, trailers); } finally { release(); }
}

function saveToolkitUnlocked(cwd, message, trailers) {
  const resumed = resumeToolkitSaveUnlocked(cwd);
  if (resumed) return resumed;
  const files = pendingToolkitFiles(cwd);
  if (!files.length) return null;
  const config = loadConfig(cwd);
  const target = shippingTarget(cwd, config);
  const indexPath = join(stateDir(cwd), `maintenance-index-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };
  const baseCommit = head(cwd);
  const sharedIndex = new Map();
  const stageText = (file, text, entry, environment) => {
    if (text === null) output("git", ["update-index", "--force-remove", "--", file], { cwd, env: environment });
    else {
      const hash = output("git", ["hash-object", "-w", "--stdin"], { cwd, input: text });
      output("git", ["update-index", "--add", "--cacheinfo", entry?.mode ?? "100644", hash, file], { cwd, env: environment });
    }
  };
  try {
    output("git", ["read-tree", ...(baseCommit ? [baseCommit] : ["--empty"])], { cwd, env });
    const owned = files.filter((file) => !SHARED.has(file));
    if (owned.length) output("git", ["--literal-pathspecs", "add", "-A", "--", ...owned], { cwd, env });
    for (const file of files.filter((file) => SHARED.has(file))) {
      const working = workingText(cwd, file);
      const entry = stagedEntry(file, cwd);
      const staged = entry ? outputRaw("git", ["cat-file", "blob", entry.hash], { cwd }) : null;
      sharedIndex.set(file, { text: ownedText(file, staged, working), entry });
      const baseMode = baseCommit ? output("git", ["--literal-pathspecs", "ls-tree", baseCommit, "--", file], { cwd }).split(" ")[0] : null;
      stageText(file, ownedText(file, committedText(cwd, file), working), { mode: baseMode || "100644" }, env);
    }
    const indexBefore = Object.fromEntries(files.map((file) => [file, stagedEntry(file, cwd)]));
    const indexAfter = {};
    for (const file of owned) {
      const records = outputRaw("git", ["--literal-pathspecs", "ls-files", "--stage", "-z", "--", file], { cwd, env });
      const [mode, hash] = records.split("\t")[0].split(" ");
      indexAfter[file] = hash ? { mode, hash } : null;
    }
    for (const [file, { text, entry }] of sharedIndex) indexAfter[file] = text === null ? null : { mode: entry?.mode ?? "100644", hash: output("git", ["hash-object", "-w", "--stdin"], { cwd, input: text }) };
    const journal = { baseCommit, expectedTree: output("git", ["write-tree"], { cwd, env }), target, files, indexBefore, indexAfter };
    writeJson(maintenanceSavePath(cwd), journal);
    const args = ["commit", "--quiet", "-m", message];
    for (const [key, value] of Object.entries(trailers)) args.push("--trailer", `${key}: ${value}`);
    output("git", args, { cwd, env });
    const savedCommit = head(cwd);
    writeJson(maintenanceSavePath(cwd), { ...journal, savedCommit });
    if (!commitMatches(cwd, savedCommit, journal)) throw refused("Commit hooks changed the toolkit save. It has not been sent.", { agent: `Inspect it, then keep the changes with git reset --soft ${baseCommit} and run save-toolkit again.` });
    // Advance only owned entries in the real index; unrelated staged text remains staged.
    advanceMaintenanceIndex(cwd, journal);
    const pushed = deliver(cwd, savedCommit, target, "save-toolkit");
    rmSync(maintenanceSavePath(cwd), { force: true });
    return { commit: savedCommit, files, pushed };
  } finally {
    rmSync(indexPath, { force: true });
  }
}

function maintenanceSavePath(cwd) { return join(stateDir(cwd), "maintenance-save.json"); }

export function resumeToolkitSave(cwd) {
  const release = acquireSaveLock(stateDir(cwd));
  try { return resumeToolkitSaveUnlocked(cwd); } finally { release(); }
}

function resumeToolkitSaveUnlocked(cwd) {
  const path = maintenanceSavePath(cwd);
  if (!existsSync(path)) return null;
  const journal = readJson(path);
  if (head(cwd) === journal.baseCommit) { rmSync(path, { force: true }); return null; }
  const savedCommit = journal.savedCommit ?? head(cwd);
  if (head(cwd) !== savedCommit || !commitMatches(cwd, savedCommit, journal)) throw refused("An unfinished toolkit save needs review before more work starts.", { agent: `Inspect it; keep its changes with git reset --soft ${journal.baseCommit}, then run save-toolkit again. Never push an altered batch.` });
  advanceMaintenanceIndex(cwd, journal);
  const pushed = deliver(cwd, savedCommit, journal.target, "save-toolkit");
  rmSync(path, { force: true });
  return { commit: savedCommit, files: journal.files, pushed };
}

function advanceMaintenanceIndex(cwd, journal) {
  // Idempotent even after a crash halfway through index reconciliation. A user's
  // subsequent staging is never overwritten by recovery of an older save.
  for (const [file, entry] of Object.entries(journal.indexAfter ?? {})) {
    const current = stagedEntry(file, cwd);
    if (JSON.stringify(current) !== JSON.stringify(journal.indexBefore[file]) && JSON.stringify(current) !== JSON.stringify(entry)) {
      throw refused("Staged toolkit files changed during the save.", { agent: "Inspect and preserve the newer staged work before resuming this toolkit save." });
    }
  }
  for (const [file, entry] of Object.entries(journal.indexAfter ?? {})) {
    if (entry) output("git", ["update-index", "--add", "--cacheinfo", entry.mode, entry.hash, file], { cwd });
    else output("git", ["update-index", "--force-remove", "--", file], { cwd });
  }
}

export function hasPendingToolkitSave(cwd) { return existsSync(maintenanceSavePath(cwd)); }
