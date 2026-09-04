// Extract import statements from source lines and resolve local targets to
// repo-relative paths. Supports JavaScript/TypeScript, Python, Go, and Rust.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";

import { normalize } from "./glob.mjs";
import { languageOf } from "./rules.mjs";

const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".json"];
const JS_PATTERNS = [
  /\bimport\s+(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:[\w*{}\s,$]+\s+)?from\s+["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

// lines: [{ line, text }]. Returns [{ line, specifier }].
export function extractImports(file, lines) {
  const language = languageOf(file);
  const out = [];
  for (const { line, text } of lines) {
    for (const specifier of specifiersIn(language, text)) out.push({ line, specifier, language });
  }
  return out;
}

export function extractFileImports(root, file) {
  const path = join(root, file);
  if (!existsSync(path) || !statSync(path).isFile()) return [];
  const text = readFileSync(path, "utf8");
  return extractImports(file, text.split(/\r?\n/).map((line, index) => ({ line: index + 1, text: line })));
}

function specifiersIn(language, text) {
  const found = [];
  if (language === "javascript" || language === "typescript") {
    for (const pattern of JS_PATTERNS) for (const match of text.matchAll(pattern)) found.push(match[1]);
  } else if (language === "python") {
    const from = /^\s*from\s+([\w.]+)\s+import\b/.exec(text);
    if (from) found.push(from[1]);
    const plain = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/.exec(text);
    if (plain) found.push(...plain[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0]));
  } else if (language === "go") {
    const single = /^\s*import\s+(?:\w+\s+)?"([^"]+)"/.exec(text);
    if (single) found.push(single[1]);
    const inBlock = /^\s*(?:\w+\s+)?"([\w./~-]+)"\s*(?:\/\/.*)?$/.exec(text);
    if (inBlock && !single) found.push(inBlock[1]);
  } else if (language === "rust") {
    const use = /^\s*(?:pub\s+)?use\s+crate::([\w:]+)/.exec(text);
    if (use) found.push(`crate::${use[1]}`);
  }
  return found;
}

// Resolve to a repo-relative path. Returns null for external packages.
export function resolveImportTarget(root, file, specifier, language, { aliases = {}, goModule = readGoModule(root) } = {}) {
  const fromDir = posix.dirname(normalize(file));
  if (language === "javascript" || language === "typescript") {
    let target = null;
    if (specifier.startsWith(".")) target = posix.normalize(posix.join(fromDir, specifier));
    else {
      for (const [alias, replacement] of Object.entries(aliases)) {
        if (specifier.startsWith(alias)) target = posix.normalize(`${replacement}${specifier.slice(alias.length)}`);
      }
    }
    if (!target) return null;
    return realFile(root, target, JS_EXTENSIONS) ?? target;
  }
  if (language === "python") {
    if (specifier.startsWith(".")) {
      const dots = /^\.+/.exec(specifier)[0].length;
      const rest = specifier.slice(dots).split(".").filter(Boolean);
      let base = fromDir;
      for (let index = 1; index < dots; index += 1) base = posix.dirname(base);
      const target = posix.join(base, ...rest);
      return realFile(root, target, [".py"]) ?? target;
    }
    const parts = specifier.split(".");
    for (const prefix of ["", "src"]) {
      const candidate = posix.join(prefix, ...parts);
      const real = realFile(root, candidate, [".py"]);
      if (real) return real;
    }
    return null;
  }
  if (language === "go") {
    if (goModule && specifier.startsWith(`${goModule}/`)) return specifier.slice(goModule.length + 1);
    if (goModule && specifier === goModule) return ".";
    return null;
  }
  if (language === "rust" && specifier.startsWith("crate::")) {
    // The last segment is often an item (struct, fn), not a module: try both.
    const segments = specifier.slice(7).split("::").filter((segment) => segment && segment !== "*" && !segment.startsWith("{"));
    for (const length of [segments.length, segments.length - 1]) {
      if (length < 1) break;
      const target = posix.join("src", ...segments.slice(0, length));
      const real = realFile(root, target, [".rs"]);
      if (real) return real;
    }
    return posix.join("src", ...segments);
  }
  return null;
}

function realFile(root, target, extensions) {
  const direct = join(root, target);
  if (existsSync(direct) && statSync(direct).isFile()) return target;
  for (const ext of extensions) {
    if (existsSync(`${direct}${ext}`)) return `${target}${ext}`;
  }
  if (existsSync(direct) && statSync(direct).isDirectory()) {
    for (const ext of extensions) {
      const index = join(direct, `index${ext}`);
      if (existsSync(index)) return `${target}/index${ext}`;
      const init = join(direct, `__init__${ext}`);
      if (existsSync(init)) return `${target}/__init__${ext}`;
    }
    if (existsSync(join(direct, "mod.rs"))) return `${target}/mod.rs`;
  }
  return null;
}

export function readGoModule(root) {
  const path = join(root, "go.mod");
  if (!existsSync(path)) return null;
  const match = /^module\s+(\S+)/m.exec(readFileSync(path, "utf8"));
  return match ? match[1] : null;
}

export function importsOfFile(root, file, options = {}) {
  return extractFileImports(root, file)
    .map((entry) => resolveImportTarget(root, file, entry.specifier, entry.language, options))
    .filter((target) => target && target !== ".")
    .map((target) => normalize(target));
}

export { dirname };
