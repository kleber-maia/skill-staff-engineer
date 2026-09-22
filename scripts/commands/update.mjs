// Upgrade the vendored toolkit from its recorded source (a local clone or a git URL).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { loadConfig, TOOLKIT_DIR } from "../lib/config.mjs";
import { output } from "../lib/exec.mjs";
import { readJson, readText, writeJson } from "../lib/fs-safe.mjs";
import { ok, tooling } from "../lib/output.mjs";
import { toolkitVersion } from "../lib/toolkit.mjs";
import { withInstallTransaction } from "./install.mjs";

export const description = "Upgrade the toolkit in this project from its recorded source or --from <path|git-url>.";
export const usage = "update [--from <path|git-url>] [--dry-run]";
export const CANONICAL_REPOSITORY_URL = "https://github.com/kleber-maia/skill-staff-engineer.git";

export default async function run(options) {
  return updateToolkit(options);
}

export async function updateToolkit({ cwd, flags = {}, services = {} }) {
  const manifest = readJson(resolve(cwd, TOOLKIT_DIR, "install.json"), null);
  const config = loadConfig(cwd);
  const explicit = flags.from ?? null;
  const injected = services.updateSource ?? null;
  const from = explicit ?? injected ?? manifest?.source?.url ?? CANONICAL_REPOSITORY_URL;
  const revision = config.updates.revision;
  const timeoutMs = config.updates.timeoutMs;
  const previousVersion = readText(resolve(cwd, TOOLKIT_DIR, "VERSION"), "")?.trim() || toolkitVersion();
  let sourceDir = from;
  let temp = null;
  let resolvedCommit = null;
  try {
    const mustMaterialize = isGitUrl(from) || !existsSync(from) || Boolean(revision);
    if (mustMaterialize) {
      const url = isGitUrl(from) || existsSync(from) ? from : manifest?.source?.url;
      if (!url) throw tooling("The recorded toolkit source is unavailable.", { agent: "Run update --from <path or git URL> with a reachable staff-engineer repository." });
      temp = mkdtempSync(join(tmpdir(), "staff-engineer-update-"));
      try {
        materializeRevision(url, temp, revision, timeoutMs);
      } catch (error) {
        if (config.updates.offline === "allow") {
          return ok({
            operator: "The upstream check was unavailable, so work is continuing with the installed toolkit.",
            agent: "Offline policy is allow. No toolkit files changed.",
            data: { from, previousVersion, version: previousVersion, updated: false, offline: true, revision },
          });
        }
        throw tooling("The toolkit could not check its upstream repository for the configured revision.", {
          agent: "Check network access, updates.revision, and the recorded repository URL. To work offline intentionally, set updates.offline to allow. No work session was opened.",
          data: { source: sourceKind(explicit, injected, manifest), revision, cause: error.message },
        });
      }
      sourceDir = temp;
    }
    resolvedCommit = gitRevision(sourceDir, timeoutMs);
    const cli = join(sourceDir, "scripts", "cli.mjs");
    if (!existsSync(cli)) throw tooling(`No toolkit found at ${sourceDir}.`, { agent: "Point --from at a clone of the staff-engineer repository." });

    const alreadyResolved = !flags["dry-run"] && !explicit && !injected && mustMaterialize && resolvedCommit && manifest?.source?.commit === resolvedCommit && manifest.version === previousVersion;
    if (alreadyResolved) {
      return ok({ operator: "The toolkit was already up to date.", data: { from, previousVersion, version: previousVersion, changed: [], updated: false, resolvedCommit, revision } });
    }

    const args = [cli, "install", "--target", cwd, "--yes", "--json"];
    if (flags["dry-run"]) args.push("--dry-run");
    if (resolvedCommit && resolvedCommit !== manifest?.source?.commit) args.push("--force");
    let result;
    let payload;
    const executeInstaller = () => {
      result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
      try {
        payload = JSON.parse(result.stdout || result.stderr);
      } catch {
        payload = null;
      }
      if (result.error?.code === "ETIMEDOUT") throw tooling("The toolkit installer timed out and rolled back its changes.", { agent: `Increase updates.timeoutMs if this project needs more than ${timeoutMs}ms.` });
      if (result.status !== 0 || !payload?.ok) {
        throw tooling("The upgrade did not complete; toolkit-owned files were rolled back.", { agent: payload?.agent ?? result.error?.message ?? "The source installer failed without a readable result.", data: payload?.data ?? {} });
      }
      if (!flags["dry-run"]) stabilizeRecordedSource(cwd, manifest, { explicit, injected, from, resolvedCommit });
    };
    if (flags["dry-run"]) executeInstaller();
    else withInstallTransaction(cwd, updateTransactionTargets(cwd, sourceDir), executeInstaller);
    const newVersion = payload.data?.version ?? "?";
    const changed = payload.data?.changed ?? [];
    const updated = !flags["dry-run"] && (newVersion !== previousVersion || changed.length > 0);
    return ok({
      operator: flags["dry-run"] ? payload.operator : updated ? `Updated the toolkit to version ${newVersion}.` : "The toolkit was already up to date.",
      agent: payload.agent,
      data: { from, previousVersion, ...payload.data, updated, resolvedCommit, revision },
    });
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

function materializeRevision(url, destination, revision, timeoutMs) {
  output("git", ["init", "--quiet", destination], { timeoutMs });
  output("git", ["-C", destination, "remote", "add", "origin", url], { timeoutMs });
  output("git", ["-C", destination, "fetch", "--quiet", "--depth", "1", "origin", revision ?? "HEAD"], { timeoutMs });
  output("git", ["-C", destination, "checkout", "--quiet", "--detach", "FETCH_HEAD"], { timeoutMs });
}

function gitRevision(dir, timeoutMs) {
  try {
    return output("git", ["-C", dir, "rev-parse", "HEAD"], { allowFailure: true, timeoutMs }) || null;
  } catch {
    return null;
  }
}

function updateTransactionTargets(cwd, sourceDir) {
  const installedSkills = readJson(resolve(cwd, TOOLKIT_DIR, "skills.json"), null)?.skills ?? [];
  const sourceSkillsDir = resolve(sourceDir, "skills");
  const sourceSkills = existsSync(sourceSkillsDir)
    ? readdirSync(sourceSkillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  return [
    TOOLKIT_DIR,
    ...[...new Set([...installedSkills, ...sourceSkills])].map((name) => `.agents/skills/${name}`),
    "AGENTS.md",
    "CLAUDE.md",
    ".gitignore",
    ".claude/settings.json",
  ];
}

function stabilizeRecordedSource(cwd, previous, { explicit, injected, from, resolvedCommit }) {
  const path = resolve(cwd, TOOLKIT_DIR, "install.json");
  const installed = readJson(path, null);
  if (!installed) return;
  let source;
  if (injected && !explicit) {
    source = { ...(previous?.source ?? installed.source), commit: resolvedCommit ?? installed.source?.commit ?? null };
  } else if (!explicit) {
    source = { dir: previous?.source?.dir ?? null, url: previous?.source?.url ?? (isGitUrl(from) ? from : installed.source?.url ?? null), commit: resolvedCommit ?? installed.source?.commit ?? null };
  } else if (isGitUrl(explicit)) {
    source = { dir: null, url: explicit, commit: resolvedCommit };
  } else {
    source = { ...installed.source, dir: explicit, commit: resolvedCommit };
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
