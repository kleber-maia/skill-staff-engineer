// A changed test must relate to each changed source area, through imports,
// colocated tests, filename conventions, or reviewed explicit associations. Waivers still
// cover cases that static discovery cannot establish honestly.
import { basename, dirname } from "node:path";
import { output } from "./exec.mjs";
import { matches, matchesAny } from "./glob.mjs";
import { stagedBlobHash } from "./git.mjs";
import { extractImports, resolveImportTarget } from "./imports.mjs";
import { isProductSource, isTestFile } from "./paths.mjs";

function stem(file) {
  return basename(file).replace(/\.[^.]+$/, "").replace(/(?:\.(?:test|spec)|_test|_spec)$/, "").replace(/^(?:test_|spec_)/, "");
}

function stagedText(cwd, file) {
  const hash = stagedBlobHash(file, cwd);
  return hash ? output("git", ["cat-file", "blob", hash], { cwd }) : "";
}

export function uncoveredSourceAreas(cwd, config, files) {
  const sources = files.filter((file) => isProductSource(config, file));
  const tests = files.filter((file) => isTestFile(config, file) && stagedBlobHash(file, cwd));
  const covered = new Set();
  const associations = config.rules.testAssociations ?? [];
  for (const test of tests) {
    const pending = [test], visited = new Set();
    while (pending.length && visited.size < 500) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      const text = stagedText(cwd, file);
      for (const item of extractImports(file, text.split(/\r?\n/).map((text, index) => ({ line: index + 1, text })))) {
        const target = resolveImportTarget(cwd, file, item.specifier, item.language, { aliases: config.rules.importAliases });
        if (target && !visited.has(target)) pending.push(target);
      }
    }
    for (const source of sources) {
      const associated = associations.some((entry) => matches(source, entry.source) && matchesAny(test, entry.tests));
      if (associated || visited.has(source) || dirname(test) === dirname(source) || stem(test) === stem(source)) covered.add(dirname(source));
    }
  }
  return [...new Set(sources.map(dirname))].filter((area) => !covered.has(area)).sort();
}

// Declarations describe a real test relationship; they never exempt an area from
// needing a changed, staged test. Keep paths inside the repository and positive.
export function validateTestAssociations(associations) {
  if (!Array.isArray(associations)) return ["rules.testAssociations must be an array"];
  const errors = [];
  const validPattern = (value) => typeof value === "string" && value.trim().length > 0
    && !/^[!/\\]|^[a-z]:|[\r\n\0]/i.test(value) && !value.replaceAll("\\", "/").split("/").includes("..");
  associations.forEach((entry, index) => {
    const path = `rules.testAssociations[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (!validPattern(entry.source)) errors.push(`${path}.source must be a positive repository-relative glob`);
    if (!Array.isArray(entry.tests) || !entry.tests.length || !entry.tests.every(validPattern)) errors.push(`${path}.tests must be a non-empty array of positive repository-relative globs`);
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 12) errors.push(`${path}.reason must explain the real test relationship (at least 12 characters)`);
    if (Object.keys(entry).some((key) => !["source", "tests", "reason"].includes(key))) errors.push(`${path} only accepts source, tests, and reason`);
  });
  return errors;
}
