// Upgrade the vendored toolkit from its recorded source (a local clone or a git URL).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { TOOLKIT_DIR } from "../lib/config.mjs";
import { output } from "../lib/exec.mjs";
import { readJson } from "../lib/fs-safe.mjs";
import { ok, refused, tooling } from "../lib/output.mjs";
import { toolkitVersion } from "../lib/toolkit.mjs";

export const description = "Upgrade the toolkit in this project from its recorded source or --from <path|git-url>.";
export const usage = "update [--from <path|git-url>] [--dry-run]";

export default async function run({ cwd, flags }) {
  const manifest = readJson(resolve(cwd, TOOLKIT_DIR, "install.json"), null);
  const from = flags.from ?? manifest?.source?.dir ?? manifest?.source?.url;
  if (!from) {
    throw refused("The toolkit does not know where it was installed from.", {
      agent: "Run update --from <path to a toolkit clone or its git URL>.",
    });
  }
  let sourceDir = from;
  let temp = null;
  if (isGitUrl(from) || !existsSync(from)) {
    const url = isGitUrl(from) ? from : manifest?.source?.url;
    if (!url) throw tooling(`The recorded toolkit source no longer exists: ${from}`, { agent: "Run update --from <path or git URL>." });
    temp = mkdtempSync(join(tmpdir(), "staff-engineer-update-"));
    output("git", ["clone", "--quiet", "--depth", "1", url, temp]);
    sourceDir = temp;
  }
  const cli = join(sourceDir, "scripts", "cli.mjs");
  if (!existsSync(cli)) {
    if (temp) rmSync(temp, { recursive: true, force: true });
    throw tooling(`No toolkit found at ${sourceDir}.`, { agent: "Point --from at a clone of the staff-engineer repository." });
  }
  try {
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
      throw tooling("The upgrade did not complete.", { agent: payload?.agent ?? (result.stderr || result.stdout).trim(), data: payload?.data ?? {} });
    }
    const newVersion = payload.data?.version ?? "?";
    return ok({
      operator: flags["dry-run"] ? payload.operator : newVersion === toolkitVersion() ? "The toolkit was already up to date." : `Updated the toolkit to version ${newVersion}.`,
      agent: payload.agent,
      data: { from: sourceDir, previousVersion: toolkitVersion(), ...payload.data },
    });
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

function isGitUrl(value) {
  return /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(String(value));
}
