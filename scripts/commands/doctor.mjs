// Health check for the installation plus the plain-language questions the agent
// still needs to ask the operator.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CONFIG_FILE, GATE_NAMES, gateStatus, hasConfig, loadConfig, TOOLKIT_DIR } from "../lib/config.mjs";
import { commandExists } from "../lib/exec.mjs";
import { readJson, readText } from "../lib/fs-safe.mjs";
import { isRepo } from "../lib/git.mjs";
import { hasBlock, HTML } from "../lib/managed-block.mjs";
import { EXIT, ok } from "../lib/output.mjs";
import { readSession } from "../lib/session.mjs";
import { toolkitVersion } from "../lib/toolkit.mjs";
import { BLOCK, OWNED_MARKER } from "./install.mjs";

export const description = "Check the installation and list the questions still open for the operator.";
export const usage = "doctor [--which]";

const QUESTIONS = {
  install: "How do you install this project's dependencies before working on it?",
  format: "Is there a code-formatting check you normally run? (Say 'none' if not.)",
  lint: "Is there a code-style or lint check you normally run? (Say 'none' if not.)",
  typecheck: "Is there a type check or compile check you normally run? (Say 'none' if not.)",
  test: "How do you run the automated tests for this project? (If there are none yet, say so.)",
  e2e: "Is there a slower end-to-end or browser test suite? (Say 'none' if not.)",
  build: "How do you build or package the project for release? (Say 'none' if not needed.)",
  preview: "How do you normally start the project to look at it or try it out?",
};

export default async function run({ cwd, flags }) {
  const checks = [];
  const questions = [];
  const add = (name, status, detail = "") => checks.push({ name, status, detail });

  const [major] = process.versions.node.split(".").map(Number);
  add("node", major >= 20 ? "ok" : "fail", `Node ${process.versions.node}${major >= 20 ? "" : " (need 20 or newer)"}`);
  add("git", commandExists("git") ? "ok" : "fail", commandExists("git") ? "" : "git is not installed or not on PATH");
  add("repository", isRepo(cwd) ? "ok" : "fail", isRepo(cwd) ? "" : "not a git repository");

  const vendoredVersion = readText(resolve(cwd, TOOLKIT_DIR, "VERSION"), "")?.trim();
  const running = toolkitVersion();
  if (!vendoredVersion) add("toolkit", "fail", `${TOOLKIT_DIR}/ is missing; run install`);
  else add("toolkit", vendoredVersion === running ? "ok" : "warn", vendoredVersion === running ? `version ${running}` : `project has ${vendoredVersion}, this toolkit is ${running}; rerun install to upgrade`);

  let config = null;
  if (!hasConfig(cwd)) add("config", "fail", `${CONFIG_FILE} is missing; run install`);
  else {
    try {
      config = loadConfig(cwd);
      add("config", "ok", `${config.languages.join(", ") || "no language detected"}; operator mode ${config.operator.mode}`);
    } catch (error) {
      add("config", "fail", error.errors?.join("; ") ?? error.message);
    }
  }

  if (config) {
    for (const name of GATE_NAMES) {
      const status = gateStatus(config, name);
      if (status === "unknown") {
        add(`gate:${name}`, "question", "not configured yet");
        questions.push({ key: `gates.${name}`, question: QUESTIONS[name], howToRecord: `config set gates.${name}.cmd "<command>"  or  config set gates.${name} null` });
      } else if (status === "na") add(`gate:${name}`, "ok", "not applicable");
      else {
        const cmd = config.gates[name].cmd;
        const binary = firstToken(cmd);
        const present = flags.which ? commandExists(binary, { cwd }) : true;
        add(`gate:${name}`, present ? "ok" : "warn", present ? cmd : `${cmd}  ("${binary}" not found on PATH)`);
      }
    }
    const preview = config.preview ?? { kind: "manual" };
    if (preview.kind === "web" && !preview.url) {
      add("preview", "question", "web preview without an address");
      questions.push({ key: "preview.url", question: "Which web address do you open to see the project while it runs?", howToRecord: 'config set preview.url "http://..."' });
    } else if (preview.kind === "manual" && !preview.instructions) {
      add("preview", "question", "no way to show results recorded");
      questions.push({ key: "preview", question: QUESTIONS.preview, howToRecord: 'config set preview \'{"kind":"web","cmd":"...","url":"http://..."}\'  or  config set preview.instructions "How the operator sees results"' });
    } else add("preview", "ok", `${preview.kind}${preview.url ? ` ${preview.url}` : preview.cmd ? ` ${preview.cmd}` : ""}`);
    if (!config.paths.source.length) add("paths.source", "warn", "no source globs; every non-test file counts as source");
  }

  const skillsManifest = readJson(resolve(cwd, TOOLKIT_DIR, "skills.json"), null);
  if (skillsManifest?.skills?.length) {
    const missing = skillsManifest.skills.filter((name) => !existsSync(resolve(cwd, ".agents/skills", name, "SKILL.md")));
    const foreign = skillsManifest.skills.filter((name) => existsSync(resolve(cwd, ".agents/skills", name)) && !existsSync(resolve(cwd, ".agents/skills", name, OWNED_MARKER)));
    add("skills", missing.length ? "fail" : foreign.length ? "warn" : "ok", missing.length ? `missing: ${missing.join(", ")}` : foreign.length ? `not toolkit-owned: ${foreign.join(", ")}` : `${skillsManifest.skills.length} skills in .agents/skills`);
  } else add("skills", "fail", "no skills manifest; run install");

  const agents = readText(resolve(cwd, "AGENTS.md"));
  add("AGENTS.md", agents && hasBlock(agents, BLOCK, HTML) ? "ok" : "fail", agents && hasBlock(agents, BLOCK, HTML) ? "managed block present" : "managed block missing; run install");
  const claude = readText(resolve(cwd, "CLAUDE.md"));
  add("CLAUDE.md", claude && /@AGENTS\.md/.test(claude) ? "ok" : "warn", claude && /@AGENTS\.md/.test(claude) ? "imports AGENTS.md" : "does not import AGENTS.md (Claude Code will not read the contract)");
  const claudeSkills = resolve(cwd, ".claude", "skills");
  if (existsSync(claudeSkills) && lstatSync(claudeSkills).isSymbolicLink()) add(".claude/skills", "ok", "symbolic link left in place");

  try {
    const session = readSession(cwd);
    add("session", "ok", !session || session.cleared || session.status === "synced" ? "no work in progress" : `${session.status}/${session.phase}: ${session.concern}`);
  } catch (error) {
    add("session", "fail", error.message);
  }

  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const result = ok({
    operator: failures.length
      ? `The toolkit setup has ${failures.length} problem${failures.length === 1 ? "" : "s"} to fix.`
      : questions.length
        ? `The toolkit is installed. I have ${questions.length} quick question${questions.length === 1 ? "" : "s"} about how the project is checked and started.`
        : "The toolkit is installed and fully configured.",
    agent: [
      ...checks.map((check) => `${icon(check.status)} ${check.name}${check.detail ? `: ${check.detail}` : ""}`),
      questions.length ? `\nAsk the operator one question at a time, in plain language, then record each answer:\n${questions.map((question) => `- ${question.question}\n    ${question.howToRecord}`).join("\n")}` : "",
    ].filter(Boolean).join("\n"),
    data: { ok: !failures.length, checks, questions, warnings: warnings.length },
  });
  if (failures.length) result.code = EXIT.FAILED;
  return result;
}

function icon(status) {
  return { ok: "ok  ", warn: "warn", fail: "FAIL", question: "ask " }[status] ?? status;
}

function firstToken(command) {
  const token = String(command).trim().split(/\s+/)[0] ?? "";
  return token.includes("/") ? token.split("/").pop() : token;
}

export function readPackageVersion(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}
