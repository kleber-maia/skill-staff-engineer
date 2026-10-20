// Operator approvals. The agent passes the operator's own words with
// --approval-quote; the toolkit never asks the operator to run anything. When the
// harness records operator messages (the Claude Code UserPromptSubmit hook), the
// quote must match a message received after the event being approved.
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { readJson, writeJson } from "./fs-safe.mjs";
import { stateDir } from "./git.mjs";
import { refused } from "./output.mjs";

export const OPERATOR_LOG = "operator-messages.json";
const KEEP_MESSAGES = 20;
const MAX_MESSAGE = 2000;
const MAX_QUOTE = 300;
// Evidence is checked in the complete reply, never in a cherry-picked phrase.
const NOT_APPROVAL = /\b(hold|wait|not yet|stop|no|nope|don'?t|do not|but|however|unless|if|once|before|after|provided|can you|could you|please change|please fix|still broken)\b/;
const WITHDRAWAL = /\b(hold|wait|stop|not yet|no|nope|don'?t|do not|cancel|please change|please fix|still broken)\b/;

function approvalWords(text) {
  // Common statements of satisfaction are affirmative despite the word "no".
  return normalizeWords(text).replace(/\bno (changes|issues|problems|concerns)( needed| required| found)?\b/g, "all good");
}

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
  const messages = [...(readOperatorLog(cwd)?.messages ?? []), { id: randomUUID(), at: now, text: message, truncated: String(text ?? "").trim().length > MAX_MESSAGE }].slice(-KEEP_MESSAGES);
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
  if (!words || quote.includes("?") || NOT_APPROVAL.test(approvalWords(quote))) {
    throw refused("Those words are a question or a request to wait, not approval.", {
      agent: "Answer the operator, keep working on their feedback, and ask again when they are ready.",
    });
  }
  const log = readOperatorLog(cwd);
  if (!log) return { quote, evidence: "agent-reported" };
  const recent = log.messages.filter((message) => !since || message.at >= since);
  const reply = recent.at(-1);
  if (!reply || !` ${normalizeWords(reply.text)} `.includes(` ${words} `)) {
    throw refused(`The operator has not said "${quote}" since ${since ? "that step was presented" : "the concern started"}.`, {
      agent: "Quote the operator's reply verbatim, and only a reply they sent after you presented the step. If they have not approved yet, wait for them.",
    });
  }
  if (reply.truncated || reply.text.includes("?") || NOT_APPROVAL.test(approvalWords(reply.text))) {
    throw refused("The operator's complete reply contains a question, condition, or request to wait or change the result.", { agent: "Address the feedback and ask again. Do not extract approval from a mixed or negative reply." });
  }
  return { quote, evidence: "operator-log", messageAt: reply.at, messageId: reply.id ?? null, purpose, since };
}

export function approvalStillCurrent(cwd, approval) {
  if (approval?.evidence !== "operator-log") return;
  const latest = readOperatorLog(cwd)?.messages.at(-1);
  if (!latest || latest.at !== approval.messageAt || (approval.messageId && latest.id !== approval.messageId)) {
    throw refused("The operator sent more feedback after that approval.", { agent: "Address the latest reply; present changes again or obtain fresh approval before saving." });
  }
}

// Retrying a network operation needs no second approval, but a later withdrawal
// must stop pending delivery. Harmless retry requests do not invalidate the save.
export function assertDeliveryNotWithdrawn(cwd, approval) {
  if (approval?.evidence !== "operator-log") return;
  const messages = readOperatorLog(cwd)?.messages ?? [];
  const approved = messages.findIndex((message) => approval.messageId ? message.id === approval.messageId : message.at === approval.messageAt);
  const newer = approved < 0 ? messages.filter((message) => message.at >= approval.messageAt) : messages.slice(approved + 1);
  if (newer.some((message) => message.truncated || WITHDRAWAL.test(approvalWords(message.text)))) {
    throw refused("The operator asked to pause or change this pending save.", { agent: "Resolve their latest feedback. Fresh approval can resume the same commit with ship --sync-only --approval-quote; changed work needs the documented soft-reset and ship --recover procedure." });
  }
}

export function approvalTrailers(approval) {
  return approval ? { "Operator-Approval": approval.quote, "Approval-Evidence": approval.evidence } : {};
}
