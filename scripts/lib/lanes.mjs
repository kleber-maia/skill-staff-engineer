// Lanes size the process to the work. Every lane keeps the brief, a working
// preview, the lifecycle gate, the full check, and operator approval.
//   trivial:  one operator touchpoint (the preview doubles as the save question),
//             no interview, no context packet, no simplify pass; capped in size.
//   standard: interview, context packet, preview, finishing work, handoff.
//   large:    standard plus an agreed spec and plan before the first preview.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { output } from "./exec.mjs";
import { isTracked, workingTreeHash } from "./git.mjs";
import { isProductSource } from "./paths.mjs";
import { refused } from "./output.mjs";
import { CLI, sessionConcernFiles } from "./session.mjs";

export const LANES = ["trivial", "standard", "large"];
export const DEFAULT_LANE = "standard";

export function laneOf(session) {
  return LANES.includes(session?.lane) ? session.lane : DEFAULT_LANE;
}

export function assertLane(lane) {
  if (!LANES.includes(lane)) {
    throw refused(`Unknown lane "${lane}".`, { agent: `Use one of: ${LANES.join(", ")}.` });
  }
  return lane;
}

// Product-source files and added lines in the concern so far (working tree vs the session start).
export function laneUsage(cwd, config, session) {
  const files = sessionConcernFiles(session, cwd).filter((file) => isProductSource(config, file));
  let addedLines = 0;
  for (const file of files) {
    if (isTracked(file, cwd)) {
      const stat = output("git", ["diff", "--numstat", session.baseCommit ?? "HEAD", "--", file], { cwd, allowFailure: true });
      const added = Number.parseInt(stat.split(/\s+/)[0], 10);
      addedLines += Number.isFinite(added) ? added : 0;
    } else if (existsSync(resolve(cwd, file))) {
      const text = readFileSync(resolve(cwd, file), "utf8");
      addedLines += text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
    }
  }
  return { sourceFiles: files, addedLines };
}

// Null when the concern fits its lane, otherwise a plain explanation.
export function laneOverflow(cwd, config, session) {
  if (laneOf(session) !== "trivial") return null;
  const limits = config.rules.lanes.trivial;
  const usage = laneUsage(cwd, config, session);
  if (usage.sourceFiles.length <= limits.maxSourceFiles && usage.addedLines <= limits.maxAddedLines) return null;
  return `This concern outgrew the trivial lane (${usage.sourceFiles.length} source files and ${usage.addedLines} added lines; the limit is ${limits.maxSourceFiles} files and ${limits.maxAddedLines} lines). Run ${CLI} lane standard.`;
}

// Content fingerprint of the concern's product source, recorded when a trivial
// preview doubles as the save question. The save reuses that approval only while
// the source is byte-identical to what the operator saw.
export function sourceFingerprint(cwd, config, session) {
  const files = sessionConcernFiles(session, cwd).filter((file) => isProductSource(config, file)).sort();
  return Object.fromEntries(files.map((file) => [file, workingTreeHash(file, cwd)]));
}

export function sameFingerprint(a = {}, b = {}) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
