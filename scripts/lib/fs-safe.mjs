import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { tooling } from "./output.mjs";

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

// Refuse paths that escape the root or pass through a symlinked directory.
export function assertInsideRoot(root, target) {
  const absoluteRoot = resolve(root);
  const absoluteTarget = resolve(root, target);
  const rel = relative(absoluteRoot, absoluteTarget);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw tooling(`Refusing to touch a path outside the project: ${target}`);
  }
  let cursor = absoluteRoot;
  for (const segment of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw tooling(`Refusing to write through a symbolic link: ${relative(absoluteRoot, cursor)}`);
    }
  }
  return absoluteTarget;
}

export function writeAtomic(path, content) {
  ensureDir(dirname(path));
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, path);
}

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw tooling(`Could not read ${path}: ${error.message}`);
  }
}

export function writeJson(path, value) {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readText(path, fallback = null) {
  return existsSync(path) ? readFileSync(path, "utf8") : fallback;
}

// Copy an existing file to <backupsDir>/<timestamp>/<relPath> before modifying it.
export function backupFile(root, relPath, backupsDir, stamp) {
  const source = resolve(root, relPath);
  if (!existsSync(source)) return null;
  const destination = resolve(backupsDir, stamp, relPath);
  ensureDir(dirname(destination));
  copyFileSync(source, destination);
  return destination;
}

export function copyDir(source, destination, { filter = () => true } = {}) {
  ensureDir(destination);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (!filter(from, entry)) continue;
    if (entry.isDirectory()) {
      copyDir(from, to, { filter });
    } else if (entry.isFile()) {
      ensureDir(dirname(to));
      copyFileSync(from, to);
    }
  }
}

export function removeDir(path) {
  rmSync(path, { recursive: true, force: true });
}

export function listFiles(root, { ignore = ["node_modules", ".git"] } = {}) {
  const results = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignore.includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) results.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return results.sort();
}

export function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}
