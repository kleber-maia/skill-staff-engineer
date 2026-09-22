import { loadConfig } from "../lib/config.mjs";
import { openIssuesFor, readIssues, renderIssues } from "../lib/issues.mjs";
import { ok, refused } from "../lib/output.mjs";
import { CLI, readSession, requireOpenSession, writeSession } from "../lib/session.mjs";

export const description = "List known issues (reported but not fixed), or mark one resolved by the open concern.";
export const usage = 'issues [--for "<files>"]   |   issues resolve <id>';

export default async function run({ cwd, positional, flags = {} }) {
  loadConfig(cwd);
  if (positional[0] === "resolve") {
    const session = requireOpenSession(cwd);
    const id = Number(positional[1]);
    const issue = readIssues(cwd).find((entry) => entry.id === id && entry.status === "open");
    if (!issue) throw refused(`There is no open known issue #${positional[1] ?? ""}.`, { agent: `List them with ${CLI} issues.` });
    writeSession(cwd, { ...session, resolvedIssues: [...new Set([...(session.resolvedIssues ?? []), id])] });
    return ok({ operator: "", agent: `Issue #${id} will be marked resolved when this concern is saved. Make sure a test covers the fix.`, data: { resolved: id } });
  }
  const session = readSession(cwd);
  const resolved = session?.resolvedIssues ?? [];
  const files = String(flags.for ?? "").split(/\s+/).filter(Boolean);
  const issues = files.length ? openIssuesFor(cwd, files, { resolved }) : readIssues(cwd).filter((issue) => issue.status === "open" && !resolved.includes(issue.id));
  return ok({ operator: "", agent: issues.length ? renderIssues(issues, "Open known issues:") : "No open known issues.", data: { issues } });
}
