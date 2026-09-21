import { loadConfig } from "../lib/config.mjs";
import { baselineUnchanged } from "../lib/baseline.mjs";
import { head } from "../lib/git.mjs";
import { ok, refused, ToolkitError, tooling } from "../lib/output.mjs";
import { assertCanBegin, beginSession, CLI, readSession } from "../lib/session.mjs";
import { updateToolkit } from "./update.mjs";

export const description = "Open exactly one work session for one concern.";
export const usage = 'begin "<short concern>"';

export default async function run({ cwd, positional, services = {} }) {
  // An already-open concern is not a workflow start. Refuse it before consulting
  // upstream so an update can never land in the middle of active work.
  const existing = readSession(cwd);
  assertCanBegin(existing, head(cwd), existing ? baselineUnchanged(existing.baseline, cwd) : true);

  let update;
  try {
    update = await (services.updateToolkit ?? updateToolkit)({ cwd, flags: {}, services });
  } catch (error) {
    throw beginPreflightError(error);
  }
  if (update.data.updated) {
    throw refused(`The staff-engineer toolkit updated to version ${update.data.version} before this concern started.`, {
      agent: "No work session was opened. Keep and save the toolkit upgrade as its own change, then restart this concern so the refreshed workflow code runs from the beginning.",
      data: { update: update.data, sessionOpened: false, restartRequired: true },
    });
  }
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

function beginPreflightError(error) {
  const noSession = "No work session was opened. Resolve the update check, then restart this concern.";
  if (error instanceof ToolkitError) {
    return new ToolkitError(error.message, {
      code: error.code,
      agent: [error.agent, ...(error.agent.includes("No work session was opened") ? [] : [noSession])].filter(Boolean).join("\n"),
      errors: error.errors,
      data: { ...error.data, sessionOpened: false },
    });
  }
  return tooling("The toolkit could not complete its required update check.", { agent: noSession, data: { sessionOpened: false } });
}

function summarize(files, limit = 10) {
  return files.length <= limit ? files.join(", ") : `${files.slice(0, limit).join(", ")} and ${files.length - limit} more`;
}
