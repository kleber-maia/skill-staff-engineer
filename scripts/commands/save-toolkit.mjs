import { loadConfig } from "../lib/config.mjs";
import { saveToolkit } from "../lib/maintenance.mjs";
import { ok, refused } from "../lib/output.mjs";
import { readSession } from "../lib/session.mjs";
import { toolkitVersion } from "../lib/toolkit.mjs";

export const description = "Save installing, updating, or configuring the toolkit as its own commit. Toolkit maintenance never runs the concern lifecycle.";
export const usage = 'save-toolkit ["message"]';

export default async function run({ cwd, positional }) {
  loadConfig(cwd);
  const session = readSession(cwd);
  if (session && !session.cleared && session.status === "open") {
    throw refused("A work session is open, so toolkit changes wait until it is saved or closed.", {
      agent: "Finish or abort the open concern first; toolkit maintenance is saved separately from product work.",
    });
  }
  const message = positional.join(" ").trim() || `Set up the staff-engineer toolkit ${toolkitVersion()}`;
  const saved = saveToolkit(cwd, message);
  if (!saved) return ok({ operator: "There were no toolkit changes to save.", agent: "Nothing pending under toolkit-owned paths.", data: { saved: null } });
  return ok({
    operator: "Saved the toolkit setup as its own change.",
    agent: `Committed ${saved.files.length} toolkit file${saved.files.length === 1 ? "" : "s"} as ${saved.commit.slice(0, 10)}. Product work starts with begin when the operator asks for a change.`,
    data: { saved },
  });
}
