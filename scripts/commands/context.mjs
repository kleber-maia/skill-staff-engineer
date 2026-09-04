// Task-context packet: which skills apply to the planned files, which docs and
// tests relate to them, and which local modules they import. Records a digest so
// the lifecycle gate can detect stale guidance.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import { loadConfig } from "../lib/config.mjs";
import { output } from "../lib/exec.mjs";
import { readJson, writeJson } from "../lib/fs-safe.mjs";
import { stateDir } from "../lib/git.mjs";
import { matchesAny, normalize } from "../lib/glob.mjs";
import { importsOfFile } from "../lib/imports.mjs";
import { ok, refused } from "../lib/output.mjs";
import { classify, isProtected } from "../lib/paths.mjs";
import { readSession, sessionConcernFiles } from "../lib/session.mjs";
import { assetsDir } from "../lib/toolkit.mjs";
import { isUiFile } from "../lib/ui-rules.mjs";

export const description = "Build the task-context packet for the planned files: skills by phase, related docs and tests, local dependencies.";
export const usage = "context <planned files...>   (defaults to the open concern's changed files)";

const DATA_PATTERNS = ["**/migrations/**", "**/*.sql", "**/schema*", "**/models/**", "**/seed*", "**/backup*", "**/*.db", "**/db/**", "**/database/**"];

export default async function run({ cwd, positional }) {
  const config = loadConfig(cwd);
  let files = positional.map((file) => normalize(file)).filter(Boolean);
  if (!files.length) {
    const session = readSession(cwd);
    if (session && !session.cleared && session.status === "open") files = sessionConcernFiles(session, cwd);
  }
  if (!files.length) {
    throw refused("Name the files you plan to change so the packet can be built.", { agent: `Usage: node .staff-engineer/cli.mjs ${usage}` });
  }
  const packet = buildPacket(cwd, config, files);
  writeJson(contextPath(cwd), packet);
  return ok({
    operator: "Gathered the guidance and related material for this change.",
    agent: renderPacket(packet),
    data: packet,
  });
}

export function contextPath(cwd) {
  return join(stateDir(cwd), "context.json");
}

export function readContext(cwd) {
  const path = contextPath(cwd);
  return existsSync(path) ? readJson(path) : null;
}

export function buildPacket(root, config, files, { now = new Date().toISOString() } = {}) {
  const tracked = output("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root }).split(/\r?\n/).filter(Boolean);
  const kinds = new Map(files.map((file) => [file, classify(config, file)]));

  const skills = ["staff-engineer", "grill-me", "solid"];
  if (files.some((file) => isUiFile(file))) skills.push("ui-quality");
  if (files.some((file) => matchesAny(file, DATA_PATTERNS) || isProtected(config, file))) skills.push("data-safety");
  if ((config.rules?.boundaries ?? []).length) skills.push("architecture-boundaries");
  if (new Set(files.filter((file) => kinds.get(file) === "source").map((file) => areaOf(file))).size > 2) skills.push("spec-and-plan");
  skills.push("simplify", "handoff");

  const phases = { before: ["grill-me"], build: skills.filter((name) => !["grill-me", "simplify", "handoff", "staff-engineer"].includes(name)), finish: ["simplify"], end: ["handoff"], always: ["staff-engineer"] };
  const skillEntries = skills.map((name) => {
    const path = skillPath(root, name);
    return { name, path, digest: path ? digestOf(readFileSync(join(root, path), "utf8")) : null, missing: !path };
  });

  const needles = [...new Set(files.flatMap((file) => [basename(file, extname(file)), basename(dirname(file))]).filter((needle) => needle && needle !== "." && needle.length > 2))];
  const mentions = (candidate) => {
    try {
      const text = readFileSync(join(root, candidate), "utf8");
      return needles.some((needle) => text.includes(needle));
    } catch {
      return false;
    }
  };
  const docs = tracked.filter((file) => classify(config, file) === "docs" && !files.includes(file) && mentions(file)).slice(0, 10);
  const tests = tracked.filter((file) => classify(config, file) === "tests" && !files.includes(file) && mentions(file)).slice(0, 20);
  const dependencies = [...new Set(files.flatMap((file) => importsOfFile(root, file, { aliases: config.rules?.importAliases ?? {} })))].filter((dep) => !files.includes(dep)).slice(0, 30);

  return { version: 1, at: now, files, kinds: Object.fromEntries(kinds), skills: skillEntries, phases, docs, tests, dependencies };
}

function areaOf(file) {
  return normalize(file).split("/").slice(0, 2).join("/");
}

function skillPath(root, name) {
  const local = join(".agents", "skills", name, "SKILL.md");
  if (existsSync(join(root, local))) return normalize(local);
  const repoLocal = join("skills", name, "SKILL.md");
  if (existsSync(join(root, repoLocal)) && existsSync(join(root, "scripts", "cli.mjs"))) return normalize(repoLocal);
  const toolkit = join(assetsDir(), "skills", name, "SKILL.md");
  return existsSync(toolkit) ? null : null;
}

export function digestOf(text) {
  return createHash("sha256").update(text).digest("hex");
}

// Skills whose content changed since the packet was built.
export function staleSkills(root, packet) {
  return (packet?.skills ?? []).filter((skill) => {
    if (!skill.path) return false;
    const path = join(root, skill.path);
    if (!existsSync(path)) return true;
    return digestOf(readFileSync(path, "utf8")) !== skill.digest;
  });
}

function renderPacket(packet) {
  const lines = [`Planned files (${packet.files.length}): ${packet.files.join(", ")}`, "", "Read, in this order:"];
  for (const skill of packet.skills) lines.push(`- skill ${skill.name}: ${skill.path ?? "(not installed in this project; use the toolkit copy)"}`);
  if (packet.docs.length) lines.push("", "Documentation that describes these files (update it in the same batch if behavior changes):", ...packet.docs.map((doc) => `- ${doc}`));
  if (packet.tests.length) lines.push("", "Tests that cover these files:", ...packet.tests.map((test) => `- ${test}`));
  if (packet.dependencies.length) lines.push("", "Local modules they import (read before changing call sites):", ...packet.dependencies.map((dep) => `- ${dep}`));
  lines.push("", "Phases: grill-me before building; solid" + (packet.skills.some((skill) => skill.name === "ui-quality") ? " and ui-quality" : "") + " while building; simplify only after acceptance; handoff at the end.");
  lines.push("Rerun context if the planned scope or the local imports grow. The lifecycle gate refuses when a listed skill changed after this packet.");
  return lines.join("\n");
}
