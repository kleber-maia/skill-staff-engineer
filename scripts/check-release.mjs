#!/usr/bin/env node
// Read-only release preflight. Publishing is a separate, manually approved step.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { output } from "./lib/exec.mjs";
import { compareVersions, stableVersion } from "./lib/releases.mjs";

export function checkRelease(cwd, { tag, commit } = {}) {
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(cwd, ".claude-plugin", "plugin.json"), "utf8"));
  if (!stableVersion(pkg.version) || plugin.version !== pkg.version) throw new Error("Package and plugin must have the same stable major.minor.patch version.");
  const expectedTag = `v${pkg.version}`;
  if (tag !== expectedTag) throw new Error(`Release tag must be ${expectedTag}.`);
  const head = output("git", ["rev-parse", "HEAD"], { cwd });
  if (!/^[a-f0-9]{40}$/.test(commit ?? "") || commit !== head) throw new Error("Release commit must be the full SHA of the checked-out commit.");
  if (output("git", ["status", "--porcelain"], { cwd })) throw new Error("Release checkout must be clean.");
  output("git", ["merge-base", "--is-ancestor", head, "refs/remotes/origin/main"], { cwd });
  const tags = output("git", ["tag", "--list"], { cwd }).split("\n");
  for (const existing of tags) {
    const version = existing.replace(/^v/, "");
    if (existing === `v${version}` && stableVersion(version) && compareVersions(pkg.version, version) <= 0) {
      throw new Error(`Release version must be newer than existing tag ${existing}; published versions are never reused.`);
    }
  }
  const notes = readFileSync(join(cwd, "CHANGELOG.md"), "utf8").split(/\r?\n/).find((line) => line.startsWith(`- **${pkg.version}** `));
  if (!notes?.slice(`- **${pkg.version}** `.length).trim()) throw new Error(`CHANGELOG.md needs release notes for ${pkg.version}.`);
  return { tag: expectedTag, commit: head, notes: notes.slice(2) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
    const result = checkRelease(process.cwd(), { tag: value("--tag"), commit: value("--commit") });
    process.stdout.write(`${result.notes}\n`);
  } catch (error) {
    process.stderr.write(`Release refused: ${error.message}\n`);
    process.exitCode = 1;
  }
}
