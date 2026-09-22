import { loadConfig } from "../lib/config.mjs";
import { readHistory } from "../lib/history.mjs";
import { summarize } from "../lib/insights.mjs";
import { ok } from "../lib/output.mjs";

export const description = "Summarize this machine's finished concerns (review rounds, lanes, waivers, gate blocks). Insights also surface on their own at begin and ship.";
export const usage = "stats [--json]";

export default async function run({ cwd }) {
  loadConfig(cwd);
  const summary = summarize(readHistory(cwd));
  const lines = summary.concerns
    ? [
        `${summary.saved} saved, ${summary.aborted} abandoned (${summary.byLane.trivial} trivial, ${summary.byLane.standard} standard, ${summary.byLane.large} large).`,
        summary.firstLookRate !== null ? `Right on the first look: ${Math.round(summary.firstLookRate * 100)}%. Average review rounds outside the trivial lane: ${summary.averageRounds ?? "n/a"}.` : "",
        `Lane moves: ${summary.laneMoves}. Decisions recorded: ${summary.decisions}.`,
        Object.keys(summary.waivers).length ? `Waivers: ${Object.entries(summary.waivers).map(([name, count]) => `${name} ${count}`).join(", ")}.` : "",
        Object.keys(summary.gateBlocks).length ? `Gate blocks: ${Object.entries(summary.gateBlocks).map(([rule, count]) => `${rule} ${count}`).join(", ")}.` : "",
        `Approval evidence: ${Object.entries(summary.approvalEvidence).map(([kind, count]) => `${kind} ${count}`).join(", ")}.`,
      ]
    : ["No finished concerns recorded on this machine yet."];
  return ok({ operator: "", agent: lines.filter(Boolean).join("\n"), data: summary });
}
