import { hasConfig, loadConfig } from "../lib/config.mjs";
import { nextStep, renderNext } from "../lib/next.mjs";
import { ok } from "../lib/output.mjs";
import { readSession } from "../lib/session.mjs";

export const description = "Tell the agent the one next step for the current concern: the command, the skills to read, and whether to wait for the operator.";
export const usage = "next [--json]";

export default async function run({ cwd }) {
  const config = hasConfig(cwd) ? loadConfig(cwd) : null;
  const next = nextStep({ cwd, config, session: readSession(cwd) });
  return ok({ operator: "", agent: renderNext(next), data: next });
}
