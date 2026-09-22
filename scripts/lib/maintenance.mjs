// Toolkit maintenance (install, update, uninstall) is not a concern: it never runs
// the lifecycle, and it is saved as its own commit touching only toolkit-owned paths.
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { TOOLKIT_DIR } from "./config.mjs";
import { output } from "./exec.mjs";
import { readJson } from "./fs-safe.mjs";
import { dirtyFiles, head } from "./git.mjs";

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
  return dirtyFiles(cwd).filter((file) => targets.some((target) => file === target || file.startsWith(`${target}/`)));
}

// Commits only the pending toolkit-owned files, leaving anything else staged or dirty
// untouched. Returns null when there is nothing to save; throws when git refuses.
export function saveToolkit(cwd, message, trailers = {}) {
  const files = pendingToolkitFiles(cwd);
  if (!files.length) return null;
  output("git", ["add", "-A", "--", ...files], { cwd });
  const args = ["commit", "--quiet", "--only", "-m", message];
  for (const [key, value] of Object.entries(trailers)) args.push("--trailer", `${key}: ${value}`);
  output("git", [...args, "--", ...files], { cwd });
  return { commit: head(cwd), files };
}
