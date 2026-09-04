import { ok, refused } from "../lib/output.mjs";
import { clearSession, readSession, sessionConcernFiles } from "../lib/session.mjs";

export const description = "Close an abandoned work session. Never deletes or reverts files.";
export const usage = "abort [--discard-confirmed]";

export default async function run({ cwd, flags }) {
  const session = readSession(cwd);
  if (!session || session.cleared || session.status === "synced") {
    return ok({ operator: "There is no work session to close.", data: {} });
  }
  const pending = session.status === "open" ? sessionConcernFiles(session, cwd) : [];
  if (pending.length && !flags["discard-confirmed"]) {
    throw refused(`The concern "${session.concern}" still has ${pending.length} changed file${pending.length === 1 ? "" : "s"}.`, {
      agent: `Closing the session does not remove them. Ask the operator whether to keep or drop this work; to close the session record anyway run abort --discard-confirmed. Files: ${pending.join(", ")}`,
      data: { pending },
    });
  }
  clearSession(cwd);
  return ok({
    operator: `Stopped working on "${session.concern}".`,
    agent: pending.length ? `Session closed. These files are still changed in the working tree: ${pending.join(", ")}` : "Session closed.",
    data: { concern: session.concern, pending },
  });
}
