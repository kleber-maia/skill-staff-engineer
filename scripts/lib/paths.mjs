// Classify repo-relative paths using the project config.
import { TOOLKIT_DIR } from "./config.mjs";
import { matchesAny } from "./glob.mjs";

export function isToolkitPath(file) {
  return file === "AGENTS.md" || file === "CLAUDE.md" || file.startsWith(`${TOOLKIT_DIR}/`) || file.startsWith(".agents/skills/");
}

export function isTestFile(config, file) {
  return matchesAny(file, config.paths.tests);
}

export function isDocsFile(config, file) {
  return matchesAny(file, config.paths.docs);
}

export function isGenerated(config, file) {
  return matchesAny(file, config.paths.generated);
}

export function isProtected(config, file) {
  return matchesAny(file, config.paths.protected);
}

export function isNeverStage(config, file) {
  return matchesAny(file, config.paths.neverStage);
}

// "source" | "tests" | "docs" | "generated" | "toolkit" | "other"
export function classify(config, file) {
  if (isToolkitPath(file)) return "toolkit";
  if (isTestFile(config, file)) return "tests";
  if (isDocsFile(config, file)) return "docs";
  if (isGenerated(config, file)) return "generated";
  if (config.paths.source.length) return matchesAny(file, config.paths.source) ? "source" : "other";
  return "source";
}
