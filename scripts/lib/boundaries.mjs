// Architecture boundary rules: check newly added imports in the staged diff
// against config.rules.boundaries.
import { matchesAny, normalize } from "./glob.mjs";
import { extractImports, readGoModule, resolveImportTarget } from "./imports.mjs";
import { classify } from "./paths.mjs";
import { isExcepted } from "./rules.mjs";

export function checkBoundaries(root, config, parsedDiff, { exceptions = [] } = {}) {
  const rules = Array.isArray(config.rules?.boundaries) ? config.rules.boundaries : [];
  if (!rules.length) return [];
  const aliases = config.rules?.importAliases ?? {};
  const goModule = readGoModule(root);
  const findings = [];
  for (const entry of parsedDiff) {
    if (entry.binary) continue;
    if (["tests", "generated", "toolkit"].includes(classify(config, entry.file))) continue;
    const applicable = rules.filter((rule) => matchesAny(entry.file, rule.files ?? []));
    if (!applicable.length) continue;
    const imports = extractImports(entry.file, entry.added);
    for (const { line, specifier, language } of imports) {
      const target = resolveImportTarget(root, entry.file, specifier, language, { aliases, goModule });
      if (!target) continue;
      for (const rule of applicable) {
        if (isExcepted(exceptions, rule.id, entry.file)) continue;
        if (!matchesAny(target, rule.forbid ?? [])) continue;
        if (matchesAny(target, rule.allow ?? [])) continue;
        if (rule.sameArea && sameArea(entry.file, target, rule.files)) continue;
        findings.push({
          rule: rule.id,
          severity: rule.severity ?? "block",
          file: entry.file,
          line,
          text: specifier,
          message: `${rule.message ?? "This import crosses an architecture boundary."} (imports ${target})`,
        });
      }
    }
  }
  return findings;
}

// The "area" of a path is its prefix up to and including the segment where the
// rule's `files` glob first uses a wildcard. For "src/features/*/**" that is
// "src/features/<feature>".
export function areaOf(path, filesGlobs) {
  const depth = areaDepth(filesGlobs);
  return normalize(path).split("/").slice(0, depth).join("/");
}

export function sameArea(fileA, fileB, filesGlobs) {
  return areaOf(fileA, filesGlobs) === areaOf(fileB, filesGlobs);
}

function areaDepth(filesGlobs = []) {
  let depth = 2;
  for (const glob of filesGlobs) {
    const segments = normalize(glob).split("/");
    const index = segments.findIndex((segment) => segment.includes("*"));
    if (index !== -1) depth = Math.max(depth, index + 1);
  }
  return depth;
}

export function validateBoundaryRules(rules) {
  const errors = [];
  if (!Array.isArray(rules)) return ["rules.boundaries must be an array"];
  rules.forEach((rule, index) => {
    if (!rule || typeof rule !== "object") errors.push(`rules.boundaries[${index}] must be an object`);
    else {
      if (!rule.id) errors.push(`rules.boundaries[${index}] needs an id`);
      if (!Array.isArray(rule.files) || !rule.files.length) errors.push(`rules.boundaries[${index}] needs a non-empty files array`);
      if (!Array.isArray(rule.forbid) || !rule.forbid.length) errors.push(`rules.boundaries[${index}] needs a non-empty forbid array`);
    }
  });
  return errors;
}
