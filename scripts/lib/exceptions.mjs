// Baselined exceptions: each entry needs a reason; stale entries fail the gate.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { output } from "./exec.mjs";
import { readJson, writeJson } from "./fs-safe.mjs";
import { matchesAny } from "./glob.mjs";
import { refused } from "./output.mjs";

export const EXCEPTIONS_VERSION = 1;

export function exceptionsPath(root, config) {
  return resolve(root, config.exceptionsFile ?? ".staff-engineer/exceptions.json");
}

export function loadExceptions(root, config) {
  const path = exceptionsPath(root, config);
  if (!existsSync(path)) return [];
  const data = readJson(path);
  const list = Array.isArray(data?.exceptions) ? data.exceptions : [];
  const invalid = list.filter((entry) => !entry.rule || !entry.path || String(entry.reason ?? "").trim().length < 20);
  if (invalid.length) {
    throw refused("Every exception needs a rule, a path, and a reason of at least 20 characters.", {
      agent: `Fix these entries in ${config.exceptionsFile}: ${invalid.map((entry) => JSON.stringify(entry)).join(", ")}`,
    });
  }
  return list;
}

export function addException(root, config, { rule, path, reason, now = new Date().toISOString() }) {
  const file = exceptionsPath(root, config);
  const data = existsSync(file) ? readJson(file) : { version: EXCEPTIONS_VERSION, exceptions: [] };
  data.exceptions.push({ rule, path, reason, addedAt: now });
  writeJson(file, data);
  return data.exceptions;
}

// An exception whose path matches no tracked or pending file is stale.
export function staleExceptions(root, exceptions) {
  if (!exceptions.length) return [];
  const tracked = output("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root }).split(/\r?\n/).filter(Boolean);
  return exceptions.filter((exception) => !tracked.some((file) => matchesAny(file, [exception.path])));
}
