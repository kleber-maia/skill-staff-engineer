// Project decisions log: what the operator decided and left out, recorded by ship
// and committed with the change, so later concerns (and other agents and machines)
// do not ask again. Read sparingly: only the few entries relevant to a concern.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { TOOLKIT_DIR } from "./config.mjs";
import { readJson, writeJson } from "./fs-safe.mjs";

export const DECISIONS_FILE = `${TOOLKIT_DIR}/decisions.json`;
const LIMIT = 5;
const STOPWORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "when", "what", "make", "made", "should", "would", "could", "can", "add", "fix", "update", "change", "page", "people", "users", "show", "shows"]);

export function readDecisions(cwd) {
  const path = resolve(cwd, DECISIONS_FILE);
  return existsSync(path) ? readJson(path, null)?.decisions ?? [] : [];
}

// "Export format: CSV" -> { topic: "Export format", decision: "CSV" }.
export function parseDecision(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  const index = clean.indexOf(":");
  if (index > 0 && index < clean.length - 1) return { topic: clean.slice(0, index).trim(), decision: clean.slice(index + 1).trim() };
  return { topic: clean, decision: clean };
}

// Appends this concern's decisions and non-goals. A newer decision on the same
// topic supersedes the older one. Returns the file path when anything was written.
export function appendDecisions(cwd, session, { files = [], now = new Date().toISOString() } = {}) {
  const brief = session.brief ?? {};
  const fresh = [
    ...(brief.decisions ?? []).map((text) => ({ ...parseDecision(text), kind: "decision" })),
    ...(brief.nonGoals ?? []).map((text) => ({ topic: text, decision: "Left out on purpose", kind: "non-goal" })),
  ];
  if (!fresh.length) return null;
  const existing = readDecisions(cwd);
  const base = existing.length;
  const entries = fresh.map((entry, index) => ({ id: base + index + 1, at: now, concern: session.concern, ...entry, surfaces: brief.surfaces ?? [], files }));
  const topics = new Map(entries.map((entry) => [key(entry.topic), entry.id]));
  const updated = existing.map((entry) => (!entry.supersededBy && topics.has(key(entry.topic)) ? { ...entry, supersededBy: topics.get(key(entry.topic)) } : entry));
  writeJson(resolve(cwd, DECISIONS_FILE), { version: 1, decisions: [...updated, ...entries] });
  return DECISIONS_FILE;
}

// The few active decisions that touch these files or areas, or share words with the text.
export function relevantDecisions(cwd, { text = "", files = [], surfaces = [], limit = LIMIT } = {}) {
  const active = readDecisions(cwd).filter((entry) => !entry.supersededBy);
  if (!active.length) return [];
  const words = new Set(tokens([text, ...surfaces].join(" ")));
  const areas = new Set(files.map(areaOf));
  const scored = active.map((entry) => {
    let score = 0;
    if ((entry.files ?? []).some((file) => files.includes(file))) score += 3;
    if ((entry.files ?? []).some((file) => areas.has(areaOf(file)))) score += 1;
    for (const word of new Set(tokens([entry.topic, entry.decision, entry.concern, ...(entry.surfaces ?? [])].join(" ")))) if (words.has(word)) score += 1;
    return { entry, score };
  });
  return scored.filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || b.entry.id - a.entry.id).slice(0, limit).map(({ entry }) => entry);
}

export function renderDecisions(decisions) {
  return [
    "Earlier decisions that may apply (keep them unless the operator says otherwise; do not ask again):",
    ...decisions.map((entry) => `- ${entry.kind === "non-goal" ? `Left out: ${entry.topic}` : `${entry.topic}: ${entry.decision}`} (from "${entry.concern}", ${entry.at.slice(0, 10)})`),
  ].join("\n");
}

function key(topic) {
  return tokens(topic).join(" ");
}

function tokens(text) {
  return String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter((word) => !STOPWORDS.has(word)) ?? [];
}

function areaOf(file) {
  const dir = dirname(file);
  return dir === "." ? file : dir;
}
