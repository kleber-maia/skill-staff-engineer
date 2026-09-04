#!/usr/bin/env node
// Repository self-check: forbidden terms, component frontmatter, manifest sanity,
// hook paths, rule regexes, and command modules.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

// 1. The toolkit must read as an independent project.
// Built from pieces so this file never contains the terms it forbids.
const STEM = ["op", "era"].join("");
const FORBIDDEN = [new RegExp(`${STEM}\\s?os`, "i"), new RegExp(`web-${STEM}`, "i"), new RegExp(`\\b${STEM}\\b`, "i")];
const SKIP_DIRS = new Set([".git", "node_modules", "fixtures"]);
for (const file of walk(root)) {
  const text = readFileSync(file, "utf8");
  for (const pattern of FORBIDDEN) {
    const match = pattern.exec(text);
    if (match) problems.push(`${relative(root, file)}: forbidden term "${match[0]}"`);
  }
}

// 2. Skills: name + description frontmatter, kebab-case dir, name matches dir.
for (const dir of dirs(join(root, "skills"))) {
  const skill = join(root, "skills", dir, "SKILL.md");
  if (!existsSync(skill)) {
    problems.push(`skills/${dir}: missing SKILL.md`);
    continue;
  }
  const fm = frontmatter(readFileSync(skill, "utf8"));
  if (!fm) problems.push(`skills/${dir}/SKILL.md: missing frontmatter`);
  else {
    if (fm.name !== dir) problems.push(`skills/${dir}/SKILL.md: name "${fm.name}" does not match directory`);
    if (!fm.description || fm.description.length < 40) problems.push(`skills/${dir}/SKILL.md: description missing or too short`);
  }
  if (!/^[a-z0-9-]+$/.test(dir)) problems.push(`skills/${dir}: directory must be kebab-case`);
}

// 3. Commands and agents: frontmatter with description (and name for agents).
for (const file of files(join(root, "commands"), ".md")) {
  const fm = frontmatter(readFileSync(file, "utf8"));
  if (!fm?.description) problems.push(`${relative(root, file)}: missing description frontmatter`);
}
for (const file of files(join(root, "agents"), ".md")) {
  const fm = frontmatter(readFileSync(file, "utf8"));
  if (!fm?.name || !fm?.description) problems.push(`${relative(root, file)}: agents need name and description frontmatter`);
}

// 4. Manifests.
for (const manifest of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "package.json", "hooks/hooks.json", "rules/languages.json", "rules/structural.json", "schemas/config.schema.json"]) {
  try {
    JSON.parse(readFileSync(join(root, manifest), "utf8"));
  } catch (error) {
    problems.push(`${manifest}: ${error.message}`);
  }
}
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const plugin = JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8"));
if (pkg.version !== plugin.version) problems.push(`version mismatch: package.json ${pkg.version} vs plugin.json ${plugin.version}`);
if (Object.keys(pkg.dependencies ?? {}).length) problems.push("package.json must not declare dependencies");

// 5. Hook commands reference files that exist.
const hooks = JSON.parse(readFileSync(join(root, "hooks/hooks.json"), "utf8"));
for (const entries of Object.values(hooks.hooks ?? {})) {
  for (const entry of entries) {
    for (const hook of entry.hooks ?? []) {
      const match = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/.exec(hook.command ?? "");
      if (!match) problems.push(`hooks.json: command must use \${CLAUDE_PLUGIN_ROOT}: ${hook.command}`);
      else if (!existsSync(join(root, match[1]))) problems.push(`hooks.json: missing ${match[1]}`);
    }
  }
}

// 6. Rules compile.
const rules = JSON.parse(readFileSync(join(root, "rules/languages.json"), "utf8"));
const knownLanguages = new Set(Object.keys(rules.extensions));
const ids = new Set();
for (const rule of rules.rules) {
  if (ids.has(rule.id)) problems.push(`rules/languages.json: duplicate id ${rule.id}`);
  ids.add(rule.id);
  try {
    new RegExp(rule.pattern);
  } catch (error) {
    problems.push(`rules/languages.json: ${rule.id}: ${error.message}`);
  }
  for (const language of rule.languages) if (language !== "*" && !knownLanguages.has(language)) problems.push(`rules/languages.json: ${rule.id}: unknown language ${language}`);
  if (!["block", "warn"].includes(rule.severity)) problems.push(`rules/languages.json: ${rule.id}: severity must be block or warn`);
}

// 7. Every CLI command module exists and exports default + description.
const { COMMANDS } = await import("./cli.mjs");
for (const [name, spec] of Object.entries(COMMANDS)) {
  const path = join(root, "scripts", spec.module.replace(/^\.\//, ""));
  if (!existsSync(path)) {
    problems.push(`cli.mjs: missing module for ${name}: ${spec.module}`);
    continue;
  }
  const module = await import(spec.module.replace("./", "./"));
  if (typeof module.default !== "function") problems.push(`${spec.module}: no default export`);
  if (!module.description) problems.push(`${spec.module}: missing description export`);
}

// 8. Every slash command maps to a CLI command or a skill.
for (const file of files(join(root, "commands"), ".md")) {
  const text = readFileSync(file, "utf8");
  if (!/cli\.mjs|skill/i.test(text)) problems.push(`${relative(root, file)}: should reference the CLI or a skill`);
}

if (problems.length) {
  console.error(`lint-toolkit: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log("lint-toolkit: ok");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && /\.(md|mjs|json|yml|yaml|txt)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function dirs(dir) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
}

function files(dir, ext) {
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(ext)).map((name) => join(dir, name)).filter((file) => statSync(file).isFile()) : [];
}

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (pair) out[pair[1]] = pair[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}
