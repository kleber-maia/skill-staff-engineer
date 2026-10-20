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

import { refused, tooling } from "./output.mjs";
import { randomUUID } from "node:crypto";

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

// One guarded save per checkout. A killed process leaves a recoverable journal;
// its stale lock can be replaced, while a live save is never interrupted.
export function acquireSaveLock(root) {
  const path = join(root, "save.lock");
  ensureDir(root);
  const token = randomUUID();
  const acquire = () => writeFileSync(path, JSON.stringify({ pid: process.pid, token }), { flag: "wx" });
  try { acquire(); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Serialize stale-lock recovery: two rescuers must never unlink each other's
    // newly acquired lock after both observed the same dead process.
    const recovery = `${path}.recovery`;
    try { writeFileSync(recovery, String(process.pid), { flag: "wx" }); }
    catch { throw refused("Another save is recovering the checkout lock.", { agent: "Wait for recovery. If its process has stopped, remove save.lock.recovery from the toolkit's Git state directory and retry." }); }
    try {
      const lock = readJson(path, null);
      if (lock) {
        if (!Number.isInteger(lock.pid) || lock.pid <= 0) throw refused("The save lock is invalid; inspect it before retrying.");
        let alive = true;
        try { process.kill(lock.pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; }
        if (alive) throw refused("Another save is running for this checkout.", { agent: "Wait for that save to finish instead of starting a second commit or delivery." });
        rmSync(path);
      }
      try { acquire(); } catch { throw refused("Another save acquired the checkout. Wait for it to finish."); }
    } finally { rmSync(recovery, { force: true }); }
  }
  return () => { if (readJson(path, null)?.token === token) rmSync(path, { force: true }); };
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
