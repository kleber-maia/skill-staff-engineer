import { randomUUID } from "node:crypto";
import { loadConfig } from "../lib/config.mjs";
import { acquireSaveLock } from "../lib/fs-safe.mjs";
import { stateDir } from "../lib/git.mjs";
import { ok, refused } from "../lib/output.mjs";
import { previewMode, readResources, writeResources } from "../lib/resources.mjs";
import { readSession } from "../lib/session.mjs";

export const description = "Track task-owned resources and record verified cleanup or local preview access.";
export const usage = 'resources list | mode remote|local | track "<name>" --handle "<owner and stop handle>" [--preview "<how to try it>"] | released <id> --proof "<observed result>"';

export default async function run({ cwd, positional, flags }) {
  loadConfig(cwd);
  const [action = "list", value, ...extra] = positional;
  if (extra.length) throw refused(usage);
  if (action === "list" && !value) {
    const ledger = readResources(cwd);
    const session = activeSession(cwd);
    const mode = previewMode(cwd, session, ledger);
    const descriptions = ledger.entries.map(item => {
      const scope = item.task === session?.startedAt ? "This task" : "Retained";
      const access = item.preview ? ` (preview: ${item.preview})` : "";
      return `${scope}: ${item.name} [${item.id}] — ${item.handle}${access}`;
    });
    return ok({ operator: "", agent: [`Preview mode: ${mode}.`, ...descriptions].join("\n"), data: { mode, entries: ledger.entries } });
  }
  const unlock = acquireSaveLock(stateDir(cwd));
  try {
    const ledger = readResources(cwd);
    if (action === "released" && value) {
      if (typeof flags.proof !== "string" || !flags.proof.trim()) throw refused("Verify release with the owning tool and describe what you observed using --proof.");
      const entry = ledger.entries.find(item => item.id === value);
      if (!entry && ledger.lastRelease?.id !== value) throw refused("Unknown resource ID. Inspect resources list.");
      if (entry) {
        ledger.lastRelease = { id: entry.id, name: entry.name, task: entry.task, proof: flags.proof.trim() };
        ledger.entries = ledger.entries.filter(item => item.id !== value);
      }
      writeResources(cwd, ledger);
      return ok({ operator: "", agent: "Release recorded.", data: ledger.lastRelease });
    }

    const session = activeSession(cwd);
    if (!session) throw refused("Start a task before tracking resources or changing its preview mode.");
    if (action === "mode" && ["local", "remote"].includes(value)) {
      ledger.override = { task: session.startedAt, mode: value };
      writeResources(cwd, ledger);
      return ok({ operator: `Preview mode for this task is ${value}.`, data: ledger.override });
    }

    if (action !== "track" || !value?.trim() || typeof flags.handle !== "string" || !flags.handle.trim()) throw refused(usage);
    if (flags.preview !== undefined && (typeof flags.preview !== "string" || !flags.preview.trim())) throw refused("Describe how the operator can use the preview.");
    const preview = flags.preview ?? null;
    let entry = ledger.entries.find(item => item.name === value);
    if (entry) {
      if (entry.task !== session.startedAt || entry.handle !== flags.handle || entry.preview !== preview) throw refused("That name already identifies another resource. Use a distinct name.");
    } else {
      entry = { id: randomUUID(), task: session.startedAt, name: value, handle: flags.handle, preview };
      ledger.entries.push(entry);
      writeResources(cwd, ledger);
    }
    return ok({ operator: "", agent: `Tracked ${entry.name} [${entry.id}].`, data: entry });
  } finally { unlock(); }
}

function activeSession(cwd) {
  const session = readSession(cwd);
  return session && ["open", "saved", "delivered"].includes(session.status) ? session : null;
}
