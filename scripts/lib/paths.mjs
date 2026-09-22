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

// Full-verification receipts deliberately ignore prose while still fingerprinting
// executable toolkit assets, rules, markers, and configuration.
export function isVerificationDocumentation(config, file) {
  return file === "AGENTS.md"
    || file === "CLAUDE.md"
    || /^\.agents\/skills\/[^/]+\/agents\/openai\.ya?ml$/i.test(file)
    || (isDocsFile(config, file) && /\.(?:md|adoc|rst|txt)$/i.test(file));
}

export function isDocumentable(config, file) {
  return matchesAny(file, config.paths.documentable ?? []);
}

export function isProductSource(config, file) {
  return classify(config, file) === "source";
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
  // Documentable operational surfaces are deliberately not product source,
  // even when a broad source glob overlaps them.
  if (isDocumentable(config, file)) return "other";
  if (config.paths.source.length) return matchesAny(file, config.paths.source) ? "source" : "other";
  return "source";
}
