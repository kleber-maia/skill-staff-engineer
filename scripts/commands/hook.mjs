// Claude Code hook handler. Reads the hook payload from stdin, decides, prints the
// hook protocol JSON. Fails open: any internal error results in no output, exit 0.
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { OPERATOR_LOG, recordOperatorMessage } from "../lib/approval.mjs";
import { hasConfig, loadConfig, TOOLKIT_DIR } from "../lib/config.mjs";
import { isRepo, repoRoot } from "../lib/git.mjs";
import { normalize } from "../lib/glob.mjs";
import { nextStep, renderNext } from "../lib/next.mjs";
import { EXIT } from "../lib/output.mjs";
import { classify, isGenerated, isProtected, isToolkitPath } from "../lib/paths.mjs";
import { readReceipt, receiptMatches } from "../lib/receipt.mjs";
import { requiredReview, reviewIsCurrent } from "../lib/review.mjs";
import { CLI, PHASES, readSession, sessionConcernFiles } from "../lib/session.mjs";
import { toolkitVersion } from "../lib/toolkit.mjs";

export const description = "Internal: handle a Claude Code hook event from stdin.";
export const usage = "hook <SessionStart|UserPromptSubmit|PreToolUse|Stop>";

export default async function run({ positional, stdout, invokedFrom }) {
  const event = positional[0];
  const payload = await readPayload();
  const cwd = payload?.cwd && existsSync(payload.cwd) ? payload.cwd : invokedFrom ?? process.cwd();
  const root = isRepo(cwd) ? repoRoot(cwd) : cwd;
  if (!hasConfig(root)) return silent();
  const response = decide(event, payload, root);
  if (response) stdout.write(`${JSON.stringify(response)}\n`);
  return silent();
}

function silent() {
  return { ok: true, code: EXIT.OK, data: {}, operator: "", agent: "", errors: [] };
}

async function readPayload() {
  if (process.stdin.isTTY) return {};
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

export function decide(event, payload, root) {
  const config = loadConfig(root);
  const session = activeSession(root);
  if (event === "SessionStart") return sessionStart(config, session, root);
  if (event === "UserPromptSubmit") return userPromptSubmit(config, session, root, payload);
  if (event === "PreToolUse") return preToolUse(config, session, root, payload);
  if (event === "Stop") return stop(config, session, root);
  return null;
}

function activeSession(root) {
  try {
    const session = readSession(root);
    return session && !session.cleared && session.status === "open" ? session : null;
  } catch {
    return null;
  }
}

// ---------- SessionStart ----------
function sessionStart(config, session, root) {
  const lines = [`staff-engineer ${toolkitVersion()} is installed in this project (operator mode: ${config.operator.mode}).`];
  if (session) {
    lines.push(`Open concern: "${session.concern}" — phase ${session.phase}, ${session.brief ? "brief recorded" : "NO BRIEF YET"}.`);
    const files = sessionConcernFiles(session, root);
    if (files.length) lines.push(`Concern files so far: ${files.slice(0, 15).join(", ")}${files.length > 15 ? ", ..." : ""}`);
  }
  lines.push(renderNext(nextStep({ cwd: root, config, session, quick: true })));
  lines.push(`Read .agents/skills/staff-engineer/SKILL.md (or the staff-engineer plugin skill) for the operating contract. Run ${CLI} next whenever unsure what comes next.`);
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } };
}

// ---------- UserPromptSubmit ----------
// Records the operator's own words so approvals can be checked against them,
// and reminds the agent of the one next step while a concern is open.
function userPromptSubmit(config, session, root, payload) {
  recordOperatorMessage(root, payload.prompt);
  if (!session) return null;
  const next = nextStep({ cwd: root, config, session, quick: true });
  const lines = [`staff-engineer: open concern "${session.concern}" (${session.lane ?? "standard"} lane).`, renderNext(next)];
  if (next.waitFor === "operator") lines.push("This message is the operator's reply: decide whether it is clear approval, a change request, or a question before acting.");
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: lines.join("\n") } };
}

// ---------- PreToolUse ----------
function preToolUse(config, session, root, payload) {
  const tool = payload.tool_name ?? "";
  const input = payload.tool_input ?? {};
  if (tool === "Bash") return guardBash(config, session, root, String(input.command ?? ""));
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return guardEdit(config, session, root, input.file_path ?? input.notebook_path ?? "");
  return null;
}

const DANGEROUS = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r)\s+(\/|~|\$HOME|\.\.|\*)(\s|$|\/)/, reason: "Recursive delete of the filesystem root, home, parent, or everything is not allowed." },
  { pattern: /\bgit\s+push\b[^|;&]*\s(--force|-f)(\s|$)/, reason: "Force pushes are not allowed; use --force-with-lease only with explicit operator approval." },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: "git reset --hard destroys work. Restore specific files instead, after confirming with the operator." },
  { pattern: /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, reason: "Discarding every working-tree change is not allowed. Restore specific files instead." },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/, reason: "git clean deletes untracked files. Remove specific files instead, after confirming with the operator." },
  { pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, reason: "Piping a download into a shell is not allowed. Download, inspect, then run." },
  { pattern: /\bgit\s+commit\b[^|;&]*--no-verify/, reason: "Commit hooks must not be bypassed." },
];

export function guardBash(config, session, root, command) {
  if (!command.trim()) return null;

  for (const { pattern, reason } of DANGEROUS) {
    if (pattern.test(command)) return deny(reason);
  }

  const writesProtected = protectedTargets(config, root, command);
  if (writesProtected.length) return deny(`This command writes to a protected file (${writesProtected.join(", ")}). Secrets, keys, and environment files are off limits.`);
  if (isStandaloneToolkitCommand(command)) return null;

  if (writesOperatorLog(command)) return deny("The operator's messages are recorded by the harness only. Quote the operator; never write their messages yourself.");

  const gated = session || config.rules.requireSession === "block";
  if (gated && /\bgit\s+commit\b/.test(command)) return deny(`Commits go through the guarded save: ${CLI} ship "message" --approval-quote "<the operator's words>" after the operator approved the handoff.`);
  if (gated && /\bgit\s+push\b/.test(command)) return deny(`Pushes go through ${CLI} ship --push or ship --sync-only.`);

  return null;
}

export function isStandaloneToolkitCommand(command) {
  const trimmed = command.trim();
  if (/[;&|`\r\n]|\$\(/.test(trimmed)) return false;
  const withoutEnv = trimmed.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/, "");
  const withoutNode = withoutEnv.replace(/^node(?:\.exe)?\s+/, "");
  const first = withoutNode.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/)?.slice(1).find(Boolean) ?? "";
  return first.replaceAll("\\", "/").endsWith(`/${TOOLKIT_DIR}/cli.mjs`)
    || first.replaceAll("\\", "/").endsWith("/scripts/cli.mjs")
    || first === `${TOOLKIT_DIR}/cli.mjs`;
}

function writesOperatorLog(command) {
  return command.includes(OPERATOR_LOG) && /(>>?|\btee\b|\bcp\b|\bmv\b|\bsed\s+-i|\brm\b|\btruncate\b|\bnode\b|\bpython|\bperl\b)/.test(command);
}

function protectedTargets(config, root, command) {
  const writeIndicators = /(>>?|\btee\b|\bcp\b|\bmv\b|\bsed\s+-i|\brm\b|\btruncate\b)/;
  if (!writeIndicators.test(command)) return [];
  const tokens = command.split(/[\s;&|()]+/).map((token) => token.replace(/^["']|["']$/g, "")).filter((token) => token && !token.startsWith("-"));
  return tokens.filter((token) => {
    const rel = toRelative(root, token);
    return rel && isProtected(config, rel);
  });
}

export function guardEdit(config, session, root, filePath) {
  const rel = toRelative(root, filePath);
  if (!rel) return null;
  if (rel === ".git" || rel.startsWith(".git/")) return deny("Repository internals and the toolkit's session records are managed by git and the toolkit. Do not edit them directly.");
  if (isToolkitPath(rel)) return null;
  if (isProtected(config, rel)) return deny(`${rel} is a protected file (secrets, keys, environment). Do not edit it; ask the operator to change it themselves.`);
  if (isGenerated(config, rel)) return deny(`${rel} is generated output. Change the source that produces it instead.`);

  if (!session) {
    if (config.rules.requireSession === "block") return deny(`No work session is open. Run ${CLI} begin "Short concern" first.`);
    if (config.rules.requireSession === "warn") return context(`No staff-engineer work session is open. Before changing project files, run ${CLI} begin "Short concern" so the change is tracked, briefed, previewed, and saved as one batch.`);
    return null;
  }
  const kind = classify(config, rel);
  if (session.phase === PHASES.AWAITING_FEEDBACK && (kind === "source" || kind === "other")) {
    return deny(`The preview is waiting for the operator's feedback. Run ${CLI} revise before changing ${rel}, or wait for acceptance.`);
  }
  return null;
}

// ---------- Stop ----------
function stop(config, session, root) {
  if (!session) return null;
  const notes = [];
  const files = sessionConcernFiles(session, root);
  if (session.phase === PHASES.IMPLEMENTATION && files.length && !session.brief) notes.push("Files changed but no brief is recorded; agree the outcome with the operator and record it.");
  if (session.phase === PHASES.IMPLEMENTATION && files.length && (session.reviewRound ?? 0) === 0) notes.push(`Files changed but no preview was presented yet (${CLI} preview).`);
  if (session.phase === PHASES.FINALIZING) {
    if (requiredReview(root, config, session).level && !reviewIsCurrent(root, config, session)) notes.push(`The code review for the final version is not recorded yet (${CLI} review).`);
    const receipt = readReceipt(root, "full");
    if (!receiptMatches(receipt, root, config, "working")) notes.push("Finalizing without a current full verification receipt; run lifecycle and verify --mode full before the handoff.");
  }
  if (!notes.length) return null;
  return { systemMessage: `staff-engineer: open concern "${session.concern}". ${notes.join(" ")}` };
}

// ---------- protocol helpers ----------
function deny(reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}

function context(text) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text } };
}

function toRelative(root, filePath) {
  if (!filePath) return null;
  const absolute = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = normalize(relative(root, absolute));
  if (!rel || rel.startsWith("..")) return null;
  return rel;
}
