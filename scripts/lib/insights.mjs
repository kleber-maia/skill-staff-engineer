// Insights from the local history, surfaced by the CLI at natural moments so
// nobody has to ask: agent guidance at begin, a rare operator milestone at ship.
// Each needs a minimum sample and is shown again only when its finding changes.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { output } from "./exec.mjs";
import { readJson, writeJson } from "./fs-safe.mjs";
import { stateDir } from "./git.mjs";
import { readHistory } from "./history.mjs";

const RECENT = 8;
const MIN_SAMPLE = 5;
const REPEAT_AFTER_DAYS = 14;
const MILESTONE_EVERY = 10;
const WAIVER_WORDS = { "Test-Waiver": "The test requirement", "Docs-Waiver": "The documentation requirement", "Broad-Change-Reason": "The one-area limit" };

export function summarize(history) {
  const saved = history.filter((entry) => entry.outcome === "saved");
  const reviewed = saved.filter((entry) => entry.lane !== "trivial");
  return {
    concerns: history.length,
    saved: saved.length,
    aborted: history.length - saved.length,
    firstLookRate: saved.length ? round(saved.filter((entry) => entry.reviewRounds <= 1).length / saved.length) : null,
    averageRounds: reviewed.length ? round(average(reviewed.map((entry) => entry.reviewRounds))) : null,
    byLane: Object.fromEntries(["trivial", "standard", "large"].map((lane) => [lane, saved.filter((entry) => entry.lane === lane).length])),
    laneMoves: history.filter((entry) => entry.initialLane !== entry.lane).length,
    waivers: countBy(saved.flatMap((entry) => entry.waivers ?? [])),
    gateBlocks: countBy(saved.flatMap((entry) => Object.keys(entry.gateBlocks ?? {}))),
    approvalEvidence: countBy(saved.map((entry) => entry.approvalEvidence ?? "none")),
    decisions: saved.reduce((total, entry) => total + (entry.decisions ?? 0), 0),
  };
}

// Findings for the agent, most useful first. Pure over its inputs.
export function findAgentInsights(history, { reverted = [], webPreview = false, selfCheck = "auto" } = {}) {
  const insights = [];
  const saved = history.filter((entry) => entry.outcome === "saved");
  for (const entry of saved.filter((item) => item.commit && reverted.includes(item.commit))) {
    const reviewed = entry.review ? ` It was reviewed at ${entry.review.level}; review changes to the same area at ${entry.review.level === "detailed" ? "detailed with extra care for edge cases" : "a higher level (review done --level detailed)"}.` : "";
    insights.push({ id: `reverted:${entry.commit}`, signature: entry.commit, message: `"${entry.concern}" was reverted after it was saved. Before building, find what it missed (an acceptance check, a test, an edge case) so this concern does not repeat it.${reviewed}` });
  }
  const recent = saved.slice(-RECENT);
  if (recent.length >= MIN_SAMPLE) {
    const reviewed = recent.filter((entry) => entry.lane !== "trivial");
    const rounds = reviewed.length >= MIN_SAMPLE - 2 ? average(reviewed.map((entry) => entry.reviewRounds)) : 0;
    if (rounds >= 2.5) {
      insights.push({ id: "review-rounds", signature: String(round(rounds, 1)), message: `Recent changes needed ${round(rounds, 1)} review rounds on average. Settle more in the interview (ask about the visible result and edge cases) and state exactly what the operator will see in the acceptance checks.` });
    }
    if (webPreview && selfCheck !== "off" && rounds >= 1.5 && reviewed.every((entry) => !entry.probes)) {
      insights.push({ id: "probes-unused", signature: String(reviewed.length), message: `None of the last ${reviewed.length} reviewed changes had automatic checks. Add brief --check "<n>: page <path> contains <text>" so obvious misses are caught before the operator looks.` });
    }
    for (const [name, count] of Object.entries(countBy(recent.flatMap((entry) => entry.waivers ?? [])))) {
      if (count >= MIN_SAMPLE) insights.push({ id: `waiver:${name}`, signature: `${count}/${recent.length}`, message: `${WAIVER_WORDS[name] ?? name} was waived in ${count} of the last ${recent.length} saved changes. Fix the cause instead of waiving again, or propose adjusting the rule to the operator in plain language.` });
    }
    for (const [rule, count] of Object.entries(countBy(recent.flatMap((entry) => Object.keys(entry.gateBlocks ?? {}))))) {
      if (count >= 4) insights.push({ id: `gate:${rule}`, signature: `${count}/${recent.length}`, message: `The "${rule}" check blocked ${count} of the last ${recent.length} changes. Avoid that pattern while building instead of fixing it at the gate.` });
    }
  }
  const trivial = history.filter((entry) => entry.initialLane === "trivial").slice(-6);
  const moved = trivial.filter((entry) => entry.lane !== "trivial").length;
  if (trivial.length >= 3 && moved >= 2) {
    insights.push({ id: "lane-trivial", signature: `${moved}/${trivial.length}`, message: `${moved} of the last ${trivial.length} changes started as trivial outgrew it. Choose the trivial lane only when the whole change is obvious and tiny.` });
  }
  return insights;
}

// A plain-language milestone for the operator, only every tenth saved change.
export function findOperatorInsight(history) {
  const saved = history.filter((entry) => entry.outcome === "saved");
  if (!saved.length || saved.length % MILESTONE_EVERY !== 0) return null;
  const last = saved.slice(-MILESTONE_EVERY);
  const firstLook = last.filter((entry) => entry.reviewRounds <= 1).length;
  const before = saved.slice(-2 * MILESTONE_EVERY, -MILESTONE_EVERY);
  const improved = before.length === MILESTONE_EVERY && average(before.map((entry) => entry.reviewRounds)) - average(last.map((entry) => entry.reviewRounds)) >= 0.3;
  return { id: `milestone:${saved.length}`, signature: String(saved.length), message: `That makes ${saved.length} changes saved this way; ${firstLook} of the last ${MILESTONE_EVERY} were right the first time you looked${improved ? ", fewer rounds of changes than the ten before" : ""}.` };
}

export function agentInsights(cwd, context = {}, { now = Date.now(), limit = 2 } = {}) {
  const history = readHistory(cwd);
  if (!history.length) return [];
  return unseen(cwd, findAgentInsights(history, { ...context, reverted: revertedCommits(cwd) }), now).slice(0, limit);
}

export function operatorInsight(cwd, { now = Date.now() } = {}) {
  const insight = findOperatorInsight(readHistory(cwd));
  return insight ? unseen(cwd, [insight], now)[0] ?? null : null;
}

export function renderAgentInsights(insights) {
  return insights.length ? ["From recent work on this project:", ...insights.map((insight) => `- ${insight.message}`)].join("\n") : "";
}

// Returns the insights not shown recently with the same finding, and marks them shown.
function unseen(cwd, insights, now) {
  const path = join(stateDir(cwd), "insights.json");
  const shown = existsSync(path) ? readJson(path, {})?.shown ?? {} : {};
  const fresh = insights.filter((insight) => {
    const previous = shown[insight.id];
    if (!previous) return true;
    return previous.signature !== insight.signature && now - Date.parse(previous.at) >= REPEAT_AFTER_DAYS * 86400000;
  });
  if (fresh.length) {
    for (const insight of fresh) shown[insight.id] = { at: new Date(now).toISOString(), signature: insight.signature };
    writeJson(path, { version: 1, shown });
  }
  return fresh;
}

function revertedCommits(cwd) {
  const text = output("git", ["log", "-n", "300", "--format=%B"], { cwd, allowFailure: true });
  return [...text.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)].map((match) => match[1]);
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
