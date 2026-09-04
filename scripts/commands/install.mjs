// Install or upgrade the toolkit inside a target project. Idempotent; never edits
// user content outside managed blocks; backs up every pre-existing file it changes.
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { CONFIG_FILE, configPath, defaultConfig, TOOLKIT_DIR } from "../lib/config.mjs";
import { detectStack } from "../lib/detect.mjs";
import { output } from "../lib/exec.mjs";
import { assertInsideRoot, backupFile, copyDir, ensureDir, readJson, readText, removeDir, timestamp, writeAtomic, writeJson } from "../lib/fs-safe.mjs";
import { isRepo, repoRoot } from "../lib/git.mjs";
import { HASH, HTML, removeBlock, upsertBlock } from "../lib/managed-block.mjs";
import { ok, refused, tooling } from "../lib/output.mjs";
import { assetsDir, toolkitVersion } from "../lib/toolkit.mjs";

export const description = "Install or upgrade the toolkit in a project.";
export const usage = "install [--target <dir>] [--dry-run] [--yes] [--reconfigure] [--replace-existing-skills] [--with-claude-hooks] [--init-git] [--uninstall]";

export const BLOCK = "staff-engineer";
export const OWNED_MARKER = ".staff-engineer-owned";
const SKILLS_DIR = ".agents/skills";
const BACKUPS_DIR = `${TOOLKIT_DIR}/backups`;

export default async function run({ cwd, flags, env = process.env }) {
  const target = resolve(cwd, flags.target ?? ".");
  if (!existsSync(target)) throw tooling(`The target folder does not exist: ${target}`);
  if (flags.uninstall) return uninstall(target, flags);

  const source = toolkitSource();
  if (!isRepo(target)) {
    if (!flags["init-git"]) {
      throw tooling("The project is not a git repository yet, and the lifecycle needs one to protect and save work.", {
        agent: `Ask the operator, then run install again with --init-git to create one (or run git init yourself).`,
      });
    }
    output("git", ["init", "--quiet"], { cwd: target });
  }
  const root = repoRoot(target);
  const plan = buildPlan(root, source, flags, env);

  if (flags["dry-run"]) {
    return ok({
      operator: `Dry run: ${plan.actions.length} change${plan.actions.length === 1 ? "" : "s"} would be made in ${root}.`,
      agent: plan.actions.map((action) => `${action.kind.padEnd(8)} ${action.path}${action.detail ? `  (${action.detail})` : ""}`).join("\n"),
      data: { root, dryRun: true, ...plan },
    });
  }
  if (plan.collisions.length && !flags["replace-existing-skills"]) {
    throw refused(`Existing skills with the same names were found: ${plan.collisions.join(", ")}.`, {
      agent: "Ask the operator whether they should be replaced (the old copies are backed up first), then rerun install with --replace-existing-skills.",
      data: { collisions: plan.collisions },
    });
  }

  const stamp = timestamp();
  const changed = [];
  for (const action of plan.actions) {
    if (action.kind === "unchanged") continue;
    if (action.backup && existsSync(resolve(root, action.path))) backupFile(root, action.path, resolve(root, BACKUPS_DIR), stamp);
    action.apply();
    changed.push(action);
  }

  const version = toolkitVersion();
  const manifestPath = resolve(root, TOOLKIT_DIR, "install.json");
  const previous = readJson(manifestPath, { created: [] }) ?? { created: [] };
  const created = new Set([...(previous.created ?? []), ...changed.filter((action) => action.kind === "create" && ["CLAUDE.md", "AGENTS.md", ".gitignore"].includes(action.path)).map((action) => action.path)]);
  const manifest = { version, created: [...created].sort() };
  if (JSON.stringify({ version: previous.version, created: previous.created ?? [] }) !== JSON.stringify(manifest)) writeJson(manifestPath, manifest);
  return ok({
    operator: describeInstall(plan, changed),
    agent: [
      `Installed staff-engineer ${version} into ${root}.`,
      `Changed: ${changed.length ? changed.map((action) => action.path).join(", ") : "nothing (already up to date)"}`,
      plan.questions.length ? `Open questions for the operator (ask one at a time, record with config set):\n${plan.questions.map((question) => `- ${question.key}: ${question.question}`).join("\n")}` : "No open questions from detection.",
      `Next: node ${TOOLKIT_DIR}/cli.mjs doctor`,
    ].join("\n"),
    data: { root, version, changed: changed.map(({ apply, ...rest }) => rest), questions: plan.questions, detected: plan.detected },
  });
}

function toolkitSource() {
  const dir = assetsDir();
  const scripts = join(dir, "scripts");
  const skills = join(dir, "skills");
  if (!existsSync(join(scripts, "cli.mjs")) || !existsSync(skills)) {
    throw tooling("The installer must run from a complete copy of the toolkit (a clone, the plugin, or npx), not from the vendored copy inside a project.", {
      agent: "Run: node <toolkit-clone>/scripts/cli.mjs install --target <project>",
    });
  }
  return { dir, scripts, skills, rules: join(dir, "rules"), templates: join(dir, "templates") };
}

export function buildPlan(root, source, flags = {}, env = process.env) {
  const actions = [];
  const version = toolkitVersion();
  const toolkitDir = resolve(root, TOOLKIT_DIR);
  const vendoredVersion = readText(join(toolkitDir, "VERSION"), "")?.trim();

  // 1. Vendored CLI.
  const vendorParts = [
    ["scripts/cli.mjs", `${TOOLKIT_DIR}/cli.mjs`, "file"],
    ["scripts/lib", `${TOOLKIT_DIR}/lib`, "dir"],
    ["scripts/commands", `${TOOLKIT_DIR}/commands`, "dir"],
    ["scripts/hooks", `${TOOLKIT_DIR}/hooks`, "dir"],
    ["rules", `${TOOLKIT_DIR}/rules`, "dir"],
    ["templates", `${TOOLKIT_DIR}/templates`, "dir"],
  ];
  if (vendoredVersion !== version || flags.force) {
    for (const [from, to, kind] of vendorParts) {
      actions.push({
        kind: existsSync(resolve(root, to)) ? "update" : "create",
        path: to,
        detail: `toolkit ${version}`,
        apply: () => {
          assertInsideRoot(root, to);
          if (kind === "dir") {
            removeDir(resolve(root, to));
            copyDir(join(source.dir, from), resolve(root, to), { filter: (path) => !path.endsWith(".test.mjs") });
          } else {
            writeAtomic(resolve(root, to), readFileSync(join(source.dir, from), "utf8"));
          }
        },
      });
    }
    actions.push({ kind: vendoredVersion ? "update" : "create", path: `${TOOLKIT_DIR}/VERSION`, apply: () => writeAtomic(join(toolkitDir, "VERSION"), `${version}\n`) });
  } else {
    actions.push({ kind: "unchanged", path: `${TOOLKIT_DIR}/`, detail: `already ${version}` });
  }

  // 2. Skills.
  const skillNames = readdirSync(source.skills, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const collisions = [];
  for (const name of skillNames) {
    const destination = resolve(root, SKILLS_DIR, name);
    const owned = existsSync(join(destination, OWNED_MARKER));
    const exists = existsSync(destination);
    if (exists && !owned) collisions.push(name);
    const ownedVersion = owned ? readText(join(destination, OWNED_MARKER), "").trim() : null;
    if (owned && ownedVersion === version && !flags.force) {
      actions.push({ kind: "unchanged", path: `${SKILLS_DIR}/${name}/` });
      continue;
    }
    actions.push({
      kind: exists ? "update" : "create",
      path: `${SKILLS_DIR}/${name}/`,
      detail: exists && !owned ? "replaces an existing skill (backed up)" : undefined,
      apply: () => {
        assertInsideRoot(root, `${SKILLS_DIR}/${name}`);
        if (exists && !owned) copyDir(destination, resolve(root, BACKUPS_DIR, timestamp(), SKILLS_DIR, name));
        removeDir(destination);
        copyDir(join(source.skills, name), destination);
        writeAtomic(join(destination, OWNED_MARKER), `${version}\n`);
      },
    });
  }
  const manifest = { version, skills: skillNames };
  const currentManifest = readJson(join(toolkitDir, "skills.json"), null);
  if (JSON.stringify(currentManifest) === JSON.stringify(manifest)) actions.push({ kind: "unchanged", path: `${TOOLKIT_DIR}/skills.json` });
  else actions.push({ kind: currentManifest ? "update" : "create", path: `${TOOLKIT_DIR}/skills.json`, apply: () => writeJson(join(toolkitDir, "skills.json"), manifest) });

  // 3. Config.
  let detected = null;
  let questions = [];
  const hasConfig = existsSync(configPath(root));
  if (!hasConfig || flags.reconfigure) {
    detected = detectStack(root);
    questions = detected.questions;
    const config = configFromDetection(detected, version);
    actions.push({
      kind: hasConfig ? "update" : "create",
      path: CONFIG_FILE,
      detail: hasConfig ? "regenerated from detection (--reconfigure)" : `detected: ${detected.detected.map((entry) => entry.kind).join(", ") || "unknown stack"}`,
      backup: true,
      apply: () => writeJson(configPath(root), config),
    });
  } else {
    const existing = readJson(configPath(root));
    if (existing.toolkitVersion !== version) {
      actions.push({ kind: "update", path: CONFIG_FILE, detail: "toolkitVersion stamp", backup: true, apply: () => writeJson(configPath(root), { ...existing, toolkitVersion: version }) });
    } else {
      actions.push({ kind: "unchanged", path: CONFIG_FILE });
    }
    questions = missingGateQuestions(existing);
  }
  const exceptionsPath = resolve(root, TOOLKIT_DIR, "exceptions.json");
  if (!existsSync(exceptionsPath)) actions.push({ kind: "create", path: `${TOOLKIT_DIR}/exceptions.json`, apply: () => writeJson(exceptionsPath, { version: 1, exceptions: [] }) });

  // 4. AGENTS.md, CLAUDE.md, .gitignore blocks.
  const agentsBlock = renderTemplate(readFileSync(join(source.templates, "agents-block.md"), "utf8"), { version });
  pushBlockAction(actions, root, "AGENTS.md", agentsBlock, HTML);
  const claudeText = readText(resolve(root, "CLAUDE.md"));
  if (claudeText == null) {
    actions.push({ kind: "create", path: "CLAUDE.md", apply: () => writeAtomic(resolve(root, "CLAUDE.md"), "@AGENTS.md\n") });
  } else if (!/^\s*@AGENTS\.md\s*$/m.test(claudeText)) {
    pushBlockAction(actions, root, "CLAUDE.md", "@AGENTS.md", HTML);
  } else {
    actions.push({ kind: "unchanged", path: "CLAUDE.md" });
  }
  pushBlockAction(actions, root, ".gitignore", `${TOOLKIT_DIR}/backups/`, HASH);

  // 5. Optional project-local Claude hooks (only when the plugin is not in use).
  if (flags["with-claude-hooks"] && !env.CLAUDE_PLUGIN_ROOT) {
    const settingsPath = resolve(root, ".claude", "settings.json");
    const current = readJson(settingsPath, {}) ?? {};
    const next = withClaudeHooks(current);
    const changed = JSON.stringify(current) !== JSON.stringify(next);
    actions.push({ kind: changed ? (existsSync(settingsPath) ? "update" : "create") : "unchanged", path: ".claude/settings.json", backup: true, apply: () => writeJson(settingsPath, next) });
  }

  return { actions, collisions, questions, detected, version };
}

function pushBlockAction(actions, root, file, content, style) {
  const path = resolve(root, file);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    actions.push({ kind: "unchanged", path: file, detail: "is a symbolic link; left alone" });
    return;
  }
  const current = readText(path);
  const { text, action } = upsertBlock(current, BLOCK, content, style);
  if (action === "unchanged") {
    actions.push({ kind: "unchanged", path: file });
    return;
  }
  actions.push({ kind: action === "created" ? "create" : "update", path: file, detail: `managed block ${action}`, backup: true, apply: () => writeAtomic(path, text) });
}

export function configFromDetection(detected, version) {
  const config = defaultConfig();
  config.$schema = "https://raw.githubusercontent.com/<owner>/skill-staff-engineer/main/schemas/config.schema.json";
  config.toolkitVersion = version;
  config.languages = detected.languages;
  config.packageManager = detected.packageManager;
  config.gates = detected.gates;
  config.preview = detected.preview ?? { kind: "manual", instructions: "" };
  if (detected.paths.source.length) config.paths.source = detected.paths.source;
  const { $schema, ...rest } = config;
  return { $schema, ...rest };
}

function missingGateQuestions(config) {
  const names = ["install", "format", "lint", "typecheck", "test", "e2e", "build"];
  return names.filter((name) => !Object.hasOwn(config.gates ?? {}, name)).map((name) => ({ key: `gates.${name}`, question: `How should the "${name}" check run in this project? (Say 'none' if not applicable.)` }));
}

export function withClaudeHooks(settings) {
  const next = structuredClone(settings);
  next.hooks ??= {};
  const entries = {
    SessionStart: [{ hooks: [{ type: "command", command: `node ${TOOLKIT_DIR}/hooks/session-start.mjs`, timeout: 10 }] }],
    PreToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: `node ${TOOLKIT_DIR}/hooks/pre-tool-use.mjs`, timeout: 10 }] },
      { matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: `node ${TOOLKIT_DIR}/hooks/pre-tool-use.mjs`, timeout: 10 }] },
    ],
    Stop: [{ hooks: [{ type: "command", command: `node ${TOOLKIT_DIR}/hooks/stop.mjs`, timeout: 10 }] }],
  };
  for (const [event, ours] of Object.entries(entries)) {
    const existing = Array.isArray(next.hooks[event]) ? next.hooks[event] : [];
    next.hooks[event] = [...existing.filter((entry) => !JSON.stringify(entry).includes(`${TOOLKIT_DIR}/hooks/`)), ...ours];
  }
  return next;
}

function renderTemplate(text, values) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

function describeInstall(plan, changed) {
  if (!changed.length) return "The toolkit was already installed and up to date.";
  const parts = ["The staff-engineer toolkit is set up in this project"];
  if (plan.questions.length) parts.push(`there ${plan.questions.length === 1 ? "is one question" : `are ${plan.questions.length} questions`} about how the project is checked and started`);
  return `${parts.join("; ")}.`;
}

function uninstall(target, flags) {
  if (!isRepo(target)) throw tooling("The target is not a git repository.");
  const root = repoRoot(target);
  const removed = [];
  const skillsFile = readJson(resolve(root, TOOLKIT_DIR, "skills.json"), null);
  const names = skillsFile?.skills ?? (existsSync(resolve(root, SKILLS_DIR)) ? readdirSync(resolve(root, SKILLS_DIR)) : []);
  for (const name of names) {
    const dir = resolve(root, SKILLS_DIR, name);
    if (existsSync(join(dir, OWNED_MARKER))) {
      if (!flags["dry-run"]) rmSync(dir, { recursive: true, force: true });
      removed.push(`${SKILLS_DIR}/${name}/`);
    }
  }
  const created = new Set(readJson(resolve(root, TOOLKIT_DIR, "install.json"), null)?.created ?? []);
  for (const [file, style] of [["AGENTS.md", HTML], ["CLAUDE.md", HTML], [".gitignore", HASH]]) {
    const path = resolve(root, file);
    const current = readText(path);
    if (current == null) continue;
    if (file === "CLAUDE.md" && created.has(file) && current.trim() === "@AGENTS.md") {
      if (!flags["dry-run"]) rmSync(path);
      removed.push(file);
      continue;
    }
    const { text, action } = removeBlock(current, BLOCK, style);
    if (action === "removed") {
      if (!flags["dry-run"]) {
        if (text === "" && file !== ".gitignore") rmSync(path);
        else writeAtomic(path, text);
      }
      removed.push(file);
    }
  }
  const settingsPath = resolve(root, ".claude", "settings.json");
  const settings = readJson(settingsPath, null);
  if (settings?.hooks) {
    for (const event of Object.keys(settings.hooks)) {
      settings.hooks[event] = settings.hooks[event].filter((entry) => !JSON.stringify(entry).includes(`${TOOLKIT_DIR}/hooks/`));
      if (!settings.hooks[event].length) delete settings.hooks[event];
    }
    if (!flags["dry-run"]) writeJson(settingsPath, settings);
    removed.push(".claude/settings.json (hook entries)");
  }
  if (existsSync(resolve(root, TOOLKIT_DIR))) {
    if (!flags["dry-run"]) rmSync(resolve(root, TOOLKIT_DIR), { recursive: true, force: true });
    removed.push(`${TOOLKIT_DIR}/`);
  }
  return ok({
    operator: flags["dry-run"] ? `Dry run: would remove ${removed.length} item${removed.length === 1 ? "" : "s"}.` : "The toolkit was removed from this project. Your own files were left untouched.",
    agent: removed.map((item) => `- ${relative(root, resolve(root, item)) || item}`).join("\n"),
    data: { removed },
  });
}
