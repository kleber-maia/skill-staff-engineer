import { loadConfig } from "../lib/config.mjs";
import { laneOf } from "../lib/lanes.mjs";
import { ok, refused } from "../lib/output.mjs";
import { codeTreeFingerprint } from "../lib/receipt.mjs";
import { buildPacket, rank, REVIEW_LEVELS, requiredReview, snapshot } from "../lib/review.mjs";
import { parseIssue } from "../lib/issues.mjs";
import { CLI, PHASES, requireBrief, requireOpenSession, writeSession } from "../lib/session.mjs";
import { validateReason } from "../lib/waivers.mjs";

export const description = "Prepare the code-review packet at the level this change needs, then record the finished review.";
export const usage = 'review   |   review done [--level minimum|standard|detailed] --found <n> --fixed <n> [--reported <n>] [--reason "why a lower level is enough"]';

export default async function run({ cwd, positional, flags = {} }) {
  const config = loadConfig(cwd);
  const session = requireOpenSession(cwd);
  requireBrief(session);
  assertReviewPhase(session);
  const required = requiredReview(cwd, config, session);
  if (!required.level) return ok({ operator: "", agent: "Only documentation changed, so no code review is needed.", data: { required } });
  return positional[0] === "done" ? recordReview(cwd, config, session, required, flags) : preparePacket(cwd, config, session, required);
}

function assertReviewPhase(session) {
  if (session.phase === PHASES.AWAITING_FEEDBACK) {
    throw refused("The preview is waiting for the operator's feedback.", { agent: `Wait for the reply, or run ${CLI} revise first.` });
  }
  if (session.phase === PHASES.IMPLEMENTATION && laneOf(session) !== "trivial") {
    throw refused("The code review waits until the operator accepted the working result, so it covers the final version once.", { agent: `Run ${CLI} preview and wait for acceptance.` });
  }
}

function preparePacket(cwd, config, session, required) {
  const packet = buildPacket(cwd, config, session, required);
  writeSession(cwd, { ...session, reviewPacket: { path: packet.path, at: new Date().toISOString(), level: required.level, delta: packet.delta } });
  return ok({
    operator: "",
    agent: [
      `Review level: ${required.level} (${required.reasons.join("; ")}).${packet.delta ? " Delta review: only changes since the last review." : ""}`,
      `Packet: ${packet.path} (${packet.files.length} files, ${packet.callers} callers found).`,
      INSTRUCTIONS[required.level],
      `Fix every confirmed bug, regression, and missed requirement; apply SAFE and CAREFUL cleanups; report RISKY ones. Then record it: ${CLI} review done --found <n> --fixed <n> [--reported <n>]`,
    ].join("\n"),
    data: { required, packet },
  });
}

const REVIEWER = ".agents/skills/code-review/reviewer.md";
const REFUTER = ".agents/skills/code-review/review-refuter.md";
const INSTRUCTIONS = {
  minimum: "Minimum: review it yourself with the code-review skill's minimum checklist (acceptance traced to code, edge cases, callers, tests, a quick four-lens cleanup). Do not spawn reviewers.",
  standard: `Standard: hand the packet path to ONE fresh-context reviewer with focus "all" (the reviewer agent, or any subagent told to follow ${REVIEWER}). Do not read the packet yourself. Without subagents, do one clean pass yourself following ${REVIEWER} and say so.`,
  detailed: `Detailed: in parallel, give the packet path to reviewers following ${REVIEWER} with focus correctness, requirements, and regressions (plus security when data, sign-in, or money is involved), and to the four simplify lenses; then have a refuter following ${REFUTER} try to disprove every bug, regression, requirement, and security finding. Act only on findings that survive.`,
};

function recordReview(cwd, config, session, required, flags) {
  if (!session.reviewPacket || session.reviewPacket.at < session.startedAt) {
    throw refused("No review packet was prepared for this concern.", { agent: `Run ${CLI} review first and review from its packet.` });
  }
  const level = flags.level ?? required.level;
  if (!REVIEW_LEVELS.includes(level)) throw refused(`Unknown review level "${level}".`, { agent: `Use one of: ${REVIEW_LEVELS.join(", ")}.` });
  let reason = null;
  if (rank(level) < rank(required.level)) {
    const check = validateReason(flags.reason, { name: "--reason" });
    if (!check.ok) {
      throw refused(`This change needs a ${required.level} review (${required.reasons.join("; ")}).`, {
        agent: `Review at ${required.level}, or explain why ${level} is enough with --reason "..." (40-500 characters). ${check.error}`,
      });
    }
    reason = check.value;
  }
  const counts = {};
  for (const name of ["found", "fixed", "reported"]) {
    const value = Number(flags[name] ?? 0);
    if (!Number.isInteger(value) || value < 0) throw refused(`--${name} must be a whole number.`, { agent: `Usage: ${usage}` });
    counts[name] = value;
  }
  if (counts.fixed + counts.reported > counts.found) throw refused("Fixed and reported findings cannot exceed the findings found.");
  const issues = (flags.issue ?? []).map(parseIssue);
  if (issues.length < counts.reported) {
    throw refused(`${counts.reported} finding${counts.reported === 1 ? " was" : "s were"} reported but only ${issues.length} recorded as known issues.`, {
      agent: 'Record each reported finding with --issue "file:line what is wrong" so later concerns see it.',
    });
  }
  const review = {
    level,
    required: required.level,
    reasons: required.reasons,
    ...counts,
    issues: [...(session.review?.issues ?? []), ...issues],
    reason,
    at: new Date().toISOString(),
    delta: session.reviewPacket.delta,
    codeTree: codeTreeFingerprint(cwd, config, "working").digest,
    snapshot: { ...(session.review?.snapshot ?? {}), ...snapshot(cwd, required.reviewable) },
  };
  writeSession(cwd, { ...session, review, reviewPacket: undefined });
  return ok({
    operator: "",
    agent: `Review recorded: ${level}, ${counts.found} found, ${counts.fixed} fixed, ${counts.reported} reported. If code changes again, run ${CLI} review for the delta. Run ${CLI} next.`,
    data: { review: { ...review, snapshot: undefined } },
  });
}

export function reviewTrailer(review) {
  return `${review.level} (required ${review.required}), ${review.found} found, ${review.fixed} fixed${review.reported ? `, ${review.reported} reported` : ""}`;
}
