// Operator approvals. The agent passes the operator's own words with
// --approval-quote; the toolkit never asks the operator to run anything. When the
// harness records operator messages (the Claude Code UserPromptSubmit hook), the
// quote must match a message received after the event being approved.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readJson, writeJson } from "./fs-safe.mjs";
import { stateDir } from "./git.mjs";
import { refused } from "./output.mjs";

export const OPERATOR_LOG = "operator-messages.json";
const KEEP_MESSAGES = 20;
const MAX_MESSAGE = 2000;
const MAX_QUOTE = 300;
const NOT_APPROVAL = /^(hold|wait|not yet|stop|no|nope|don'?t|do not)\b/;

export function operatorLogPath(cwd) {
  return join(stateDir(cwd), OPERATOR_LOG);
}

// Harness-recorded operator messages, oldest first. Null when no harness records them.
export function readOperatorLog(cwd) {
  const path = operatorLogPath(cwd);
  if (!existsSync(path)) return null;
  const log = readJson(path, null);
  return Array.isArray(log?.messages) ? log : null;
}

export function recordOperatorMessage(cwd, text, { now = new Date().toISOString() } = {}) {
  const message = String(text ?? "").trim().slice(0, MAX_MESSAGE);
  if (!message) return;
  const messages = [...(readOperatorLog(cwd)?.messages ?? []), { at: now, text: message }].slice(-KEEP_MESSAGES);
  writeJson(operatorLogPath(cwd), { version: 1, messages });
}

export function normalizeWords(text) {
  return String(text ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}']+/gu, " ").trim();
}

// Returns { quote, evidence } or throws a refusal the agent can act on.
// evidence: "operator-log" when a recorded operator message contains the quote,
// "agent-reported" when this harness records no operator messages.
export function checkApproval(cwd, rawQuote, { since, purpose }) {
  const quote = String(rawQuote ?? "").replace(/\s+/g, " ").trim();
  const usage = `Pass the operator's own words: --approval-quote "<what the operator said>". Never invent or paraphrase them.`;
  if (!quote) throw refused(`${purpose} needs the operator's own words of approval.`, { agent: usage });
  if (quote.length > MAX_QUOTE) throw refused("The approval quote is too long; quote only the words that approve.", { agent: usage });
  const words = normalizeWords(quote);
  if (!words || quote.endsWith("?") || NOT_APPROVAL.test(words)) {
    throw refused("Those words are a question or a request to wait, not approval.", {
      agent: "Answer the operator, keep working on their feedback, and ask again when they are ready.",
    });
  }
  const log = readOperatorLog(cwd);
  if (!log) return { quote, evidence: "agent-reported" };
  const recent = log.messages.filter((message) => !since || message.at >= since);
  if (!recent.some((message) => normalizeWords(message.text).includes(words))) {
    throw refused(`The operator has not said "${quote}" since ${since ? "that step was presented" : "the concern started"}.`, {
      agent: "Quote the operator's reply verbatim, and only a reply they sent after you presented the step. If they have not approved yet, wait for them.",
    });
  }
  return { quote, evidence: "operator-log" };
}

export function approvalTrailers(approval) {
  return approval ? { "Operator-Approval": approval.quote, "Approval-Evidence": approval.evidence } : {};
}
