// Upgrade the vendored toolkit from its recorded source (a local clone or a git URL).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { TOOLKIT_DIR } from "../lib/config.mjs";
import { output } from "../lib/exec.mjs";
import { readJson, readText, writeJson } from "../lib/fs-safe.mjs";
import { ok, tooling } from "../lib/output.mjs";
import { toolkitVersion } from "../lib/toolkit.mjs";

export const description = "Upgrade the toolkit in this project from its recorded source or --from <path|git-url>.";
export const usage = "update [--from <path|git-url>] [--dry-run]";
export const CANONICAL_REPOSITORY_URL = "https://github.com/kleber-maia/skill-staff-engineer.git";

export default async function run(options) {
  return updateToolkit(options);
}

export async function updateToolkit({ cwd, flags = {}, services = {} }) {
  const manifest = readJson(resolve(cwd, TOOLKIT_DIR, "install.json"), null);
  const explicit = flags.from ?? null;
  // updateSource is an in-process test service. It is not a CLI flag or environment
  // escape hatch, so installed production CLIs always consult their recorded remote.
  const injected = services.updateSource ?? null;
  const from = explicit ?? injected ?? manifest?.source?.url ?? CANONICAL_REPOSITORY_URL;
  const previousVersion = readText(resolve(cwd, TOOLKIT_DIR, "VERSION"), "")?.trim() || toolkitVersion();
  let sourceDir = from;
  let temp = null;
  try {
    if (isGitUrl(from) || !existsSync(from)) {
      const url = isGitUrl(from) ? from : manifest?.source?.url;
      if (!url) throw tooling("The recorded toolkit source is unavailable.", { agent: "Run update --from <path or git URL> with a reachable staff-engineer repository." });
      temp = mkdtempSync(join(tmpdir(), "staff-engineer-update-"));
      try {
        output("git", ["clone", "--quiet", "--depth", "1", url, temp]);
      } catch {
        throw tooling("The toolkit could not check its upstream repository for the newest version.", {
          agent: "Check network access and the recorded repository URL, or run update --from <path or git URL>. No work session was opened.",
          data: { source: sourceKind(explicit, injected, manifest) },
        });
      }
      sourceDir = temp;
    }
    const cli = join(sourceDir, "scripts", "cli.mjs");
    if (!existsSync(cli)) {
      throw tooling(`No toolkit found at ${sourceDir}.`, { agent: "Point --from at a clone of the staff-engineer repository." });
    }
    const args = [cli, "install", "--target", cwd, "--yes", "--json"];
    if (flags["dry-run"]) args.push("--dry-run");
    const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", windowsHide: true });
    let payload = null;
    try {
      payload = JSON.parse(result.stdout || result.stderr);
    } catch {
      payload = null;
    }
    if (result.status !== 0 || !payload?.ok) {
      throw tooling("The upgrade did not complete.", { agent: payload?.agent ?? "The source installer failed without a readable result.", data: payload?.data ?? {} });
    }
    if (!flags["dry-run"]) stabilizeRecordedSource(cwd, manifest, { explicit, injected, from });
    const newVersion = payload.data?.version ?? "?";
    const changed = payload.data?.changed ?? [];
    const updated = !flags["dry-run"] && (newVersion !== previousVersion || changed.length > 0);
    return ok({
      operator: flags["dry-run"] ? payload.operator : updated ? `Updated the toolkit to version ${newVersion}.` : "The toolkit was already up to date.",
      agent: payload.agent,
      data: { from, previousVersion, ...payload.data, updated },
    });
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

function stabilizeRecordedSource(cwd, previous, { explicit, injected, from }) {
  const path = resolve(cwd, TOOLKIT_DIR, "install.json");
  const installed = readJson(path, null);
  if (!installed) return;
  let source;
  if (injected && !explicit) {
    source = previous?.source ?? installed.source;
  } else if (!explicit) {
    source = { dir: previous?.source?.dir ?? null, url: previous?.source?.url ?? (isGitUrl(from) ? from : installed.source?.url ?? null) };
  } else if (isGitUrl(explicit)) {
    source = { dir: null, url: explicit };
  } else {
    source = installed.source;
  }
  const next = { ...installed, source };
  if (JSON.stringify(installed) !== JSON.stringify(next)) writeJson(path, next);
}

function sourceKind(explicit, injected, manifest) {
  if (explicit) return "explicit";
  if (injected) return "test";
  if (manifest?.source?.url) return "recorded-url";
  return "canonical-url";
}

export function isGitUrl(value) {
  return /^(https?:\/\/|file:\/\/|git@|ssh:\/\/|git:\/\/)/.test(String(value));
}
