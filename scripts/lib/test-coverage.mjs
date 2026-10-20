// A changed test must relate to each changed source area, through imports,
// colocated tests, or the language's usual filename convention. Waivers still
// cover cases that static discovery cannot establish honestly.
import { basename, dirname } from "node:path";
import { output } from "./exec.mjs";
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
      if (visited.has(source) || dirname(test) === dirname(source) || stem(test) === stem(source)) covered.add(dirname(source));
    }
  }
  return [...new Set(sources.map(dirname))].filter((area) => !covered.has(area)).sort();
}
