import { loadConfig } from "../lib/config.mjs";
import { readDecisions, relevantDecisions, renderDecisions } from "../lib/decisions.mjs";
import { ok } from "../lib/output.mjs";

export const description = "List the earlier operator decisions relevant to some words or files (all active ones without --for).";
export const usage = 'decisions [--for "<words or files>"]';

export default async function run({ cwd, flags = {} }) {
  loadConfig(cwd);
  const query = String(flags.for ?? "").trim();
  const decisions = query
    ? relevantDecisions(cwd, { text: query, files: query.split(/\s+/).filter((word) => word.includes("/") || word.includes(".")) })
    : readDecisions(cwd).filter((entry) => !entry.supersededBy);
  return ok({ operator: "", agent: decisions.length ? renderDecisions(decisions) : "No recorded decisions match.", data: { decisions } });
}
