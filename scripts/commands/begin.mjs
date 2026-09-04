import { loadConfig } from "../lib/config.mjs";
import { ok } from "../lib/output.mjs";
import { beginSession, CLI } from "../lib/session.mjs";

export const description = "Open exactly one work session for one concern.";
export const usage = 'begin "<short concern>"';

export default async function run({ cwd, positional }) {
  loadConfig(cwd);
  const session = beginSession(cwd, positional.join(" "));
  return ok({
    operator: `Started working on: ${session.concern}.`,
    agent: [
      "All changes for this concern must be staged and saved together as one batch.",
      session.baseline.files.length ? `Pre-existing pending files are protected and must stay out of this batch: ${summarize(session.baseline.files)}` : "",
      "Before building, agree the outcome with the operator (grill-me skill) unless the request is trivially clear, then record the brief:",
      `  ${CLI} brief --outcome "..." --accept "..." [--accept "..."] [--non-goal "..."] [--surface "..."]`,
    ].filter(Boolean).join("\n"),
    data: session,
  });
}

function summarize(files, limit = 10) {
  return files.length <= limit ? files.join(", ") : `${files.slice(0, limit).join(", ")} and ${files.length - limit} more`;
}
