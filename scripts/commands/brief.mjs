import { loadConfig } from "../lib/config.mjs";
import { ok } from "../lib/output.mjs";
import { parseCheck } from "../lib/self-check.mjs";
import { CLI, recordBrief, requireOpenSession, writeSession } from "../lib/session.mjs";

export const description = "Record the plain-language brief: outcome, acceptance checks, non-goals, surfaces.";
export const usage = 'brief --outcome "..." --accept "..." [--accept "..."] [--non-goal "..."] [--surface "..."] [--decision "Topic: choice"] [--check "1: page /path contains text"]';

export default async function run({ cwd, flags }) {
  loadConfig(cwd);
  const session = requireOpenSession(cwd);
  const accept = flags.accept ?? [];
  const updated = recordBrief(session, {
    outcome: flags.outcome,
    accept,
    nonGoals: flags["non-goal"] ?? [],
    surfaces: flags.surface ?? [],
    decisions: flags.decision ?? [],
    checks: (flags.check ?? []).map((check) => parseCheck(check, accept.length)),
  });
  writeSession(cwd, updated);
  const brief = updated.brief;
  return ok({
    operator: `Agreed: ${brief.outcome} You will be able to check: ${brief.acceptance.map((item, index) => `${index + 1}) ${item}`).join(" ")}`,
    agent: `Brief recorded. Build the smallest working first pass, run useful existing or focused regression tests, then run ${CLI} preview. Simplification, final docs, lifecycle, and the full check wait for acceptance.`,
    data: brief,
  });
}
