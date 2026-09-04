import { loadConfig } from "../lib/config.mjs";
import { addException } from "../lib/exceptions.mjs";
import { ok, refused } from "../lib/output.mjs";

export const description = "Record a permanent, justified exception to a lifecycle rule.";
export const usage = 'exception add --rule <id> --path <glob> --reason "at least 20 characters"';

export default async function run({ cwd, positional, flags }) {
  const config = loadConfig(cwd);
  if (positional[0] !== "add") throw refused(`Usage: ${usage}`);
  const { rule, path, reason } = flags;
  if (!rule || !path || String(reason ?? "").trim().length < 20) throw refused(`Usage: ${usage}`);
  const list = addException(cwd, config, { rule, path, reason: String(reason).trim() });
  return ok({
    operator: "Recorded a documented exception to one of the quality rules.",
    agent: `Exception added for ${rule} on ${path}. Stage ${config.exceptionsFile} with the batch; stale exceptions fail the gate.`,
    data: { exceptions: list },
  });
}
