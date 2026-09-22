import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "../lib/config.mjs";
import { normalize } from "../lib/glob.mjs";
import { ok, refused } from "../lib/output.mjs";
import { CLI, recordPlan, requireBrief, requireOpenSession, writeSession } from "../lib/session.mjs";

export const description = "Record the spec and plan the operator agreed to (required before the first preview in the large lane).";
export const usage = "plan <path to the agreed plan>";

export default async function run({ cwd, positional }) {
  loadConfig(cwd);
  const session = requireOpenSession(cwd);
  requireBrief(session);
  const path = normalize(positional[0] ?? "");
  if (!path || !existsSync(resolve(cwd, path)) || !readFileSync(resolve(cwd, path), "utf8").trim()) {
    throw refused("Name the written plan the operator agreed to.", { agent: `Write it with the spec-and-plan skill, get agreement, then run ${CLI} ${usage}.` });
  }
  writeSession(cwd, recordPlan(session, path));
  return ok({ operator: "", agent: `Plan recorded (${path}). Run ${CLI} next.`, data: { plan: path } });
}
