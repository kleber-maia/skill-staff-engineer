import { loadConfig } from "../lib/config.mjs";
import { ok } from "../lib/output.mjs";
import { CLI, recordBrief, requireOpenSession, writeSession } from "../lib/session.mjs";

export const description = "Record the plain-language brief: outcome, acceptance checks, non-goals, surfaces.";
export const usage = 'brief --outcome "..." --accept "..." [--accept "..."] [--non-goal "..."] [--surface "..."]';

export default async function run({ cwd, flags }) {
  loadConfig(cwd);
  const session = requireOpenSession(cwd);
  const updated = recordBrief(session, {
    outcome: flags.outcome,
    accept: flags.accept ?? [],
    nonGoals: flags["non-goal"] ?? [],
    surfaces: flags.surface ?? [],
  });
  writeSession(cwd, updated);
  const brief = updated.brief;
  return ok({
    operator: `Agreed: ${brief.outcome} You will be able to check: ${brief.acceptance.map((item, index) => `${index + 1}) ${item}`).join(" ")}`,
    agent: `Brief recorded. Build the smallest working first pass, then run ${CLI} preview. Do not write or run tests, review, simplify, or verify before the operator has seen the preview.`,
    data: brief,
  });
}
