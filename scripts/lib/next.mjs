// The single source of "what now". Commands, status, and hooks all ask this
// module, so the lifecycle order lives in code instead of in the agent's memory.
import { readContext } from "../commands/context.mjs";
import { stagedFiles } from "./git.mjs";
import { laneOf, laneOverflow, sameFingerprint, sourceFingerprint } from "./lanes.mjs";
import { readReceipt, receiptMatches } from "./receipt.mjs";
import { CLI, PHASES, STATUSES } from "./session.mjs";

const QUOTE = `--approval-quote "<the operator's exact words>"`;

// Returns { step, waitFor: "agent" | "operator", command, skills, guidance }.
// quick: skip the receipt fingerprint (hooks run on every prompt).
export function nextStep({ cwd, config, session, quick = false }) {
  if (!config) return step("install", { guidance: "The toolkit is not installed. Follow the install skill." });
  const open = session && !session.cleared && session.status === STATUSES.OPEN ? session : null;
  if (!open) {
    if (session?.status === STATUSES.SAVED) return step("sync", { command: `${CLI} ship --sync-only`, guidance: "The last concern is saved but not sent to the shared copy yet." });
    return step("begin", {
      command: `${CLI} begin "<short concern>" --lane <trivial|standard|large>`,
      guidance: [
        "Pick the lane from the request:",
        `- trivial: an obvious, low-risk change (copy, a style tweak, a one-line fix) within ${config.rules.lanes.trivial.maxSourceFiles} source files and ${config.rules.lanes.trivial.maxAddedLines} added lines, no data or security impact. One review with the operator.`,
        "- standard: anything else of normal size.",
        "- large: more than two areas, new data shapes, or more than a day of work.",
        "When unsure, choose standard. The lane can change later with the lane command.",
      ].join("\n"),
    });
  }

  const lane = laneOf(open);
  if (!open.brief) {
    return lane === "trivial"
      ? step("brief", { command: briefCommand(), guidance: "Record a one-line brief straight from the request; interview only if something is genuinely ambiguous." })
      : step("brief", { command: briefCommand(), skills: ["grill-me"], guidance: "Inspect read-only, interview the operator with grill-me (at most three questions per round, each with a recommendation), then record the agreed brief." });
  }
  if (lane === "large" && !open.plan) {
    return step("plan", { command: `${CLI} plan <path to the agreed plan>`, skills: ["spec-and-plan"], guidance: "Write the spec and plan, get the operator's agreement in plain language, then record the plan." });
  }

  if (open.phase === PHASES.IMPLEMENTATION) {
    const overflow = laneOverflow(cwd, config, open);
    if (overflow) return step("lane", { command: `${CLI} lane standard`, guidance: overflow });
    if (lane !== "trivial" && !contextIsCurrent(cwd, open)) {
      return step("context", { command: `${CLI} context <planned files...>`, guidance: "Build and read the task-context packet before editing. Rerun it when the scope or imports grow." });
    }
    return step("build", {
      command: `${CLI} preview`,
      skills: lane === "trivial" ? [] : readContext(cwd)?.phases?.build ?? ["solid"],
      guidance: [
        "Build the smallest working version that satisfies the brief. Run the relevant existing checks and add a focused regression test where it helps.",
        lane === "trivial"
          ? "For trivial work, finish tests and docs now: the preview doubles as the save question, and the source must not change after the operator approves it."
          : "Do not simplify, finish docs, or run the full check yet.",
        "Then run preview and share it with the operator.",
      ].join("\n"),
    });
  }

  if (open.phase === PHASES.AWAITING_FEEDBACK) {
    return step("await-feedback", {
      waitFor: "operator",
      command: `${CLI} finalize ${QUOTE}`,
      guidance: [
        "Stop and wait for the operator's reply.",
        `Clear acceptance ("looks good"${lane === "trivial" ? ', "ship it"' : ""}): run finalize with their words.`,
        lane === "trivial" ? "In the trivial lane that acceptance also approves saving, as long as the source stays exactly as presented." : "",
        `A change request, question, or partial praise: run ${CLI} revise and keep building.`,
      ].filter(Boolean).join("\n"),
    });
  }

  // Finalizing.
  const staged = stagedFiles(cwd);
  if (lane === "trivial" && open.presentedSource && open.acceptance) {
    if (!sameFingerprint(open.presentedSource, sourceFingerprint(cwd, config, open))) {
      return step("revise", { command: `${CLI} revise`, guidance: "The source changed after the operator approved it. Return to the preview so they see the final version." });
    }
    if (quick) return step("finish", { guidance: `Stage the whole concern, run ${CLI} lifecycle and ${CLI} verify --mode full, then ship. Run ${CLI} next for the exact step.` });
    if (!staged.length || !receiptMatches(readReceipt(cwd, "full"), cwd, config, "staged")) {
      return step("check", { command: `${CLI} lifecycle && ${CLI} verify --mode full`, guidance: "Stage the entire concern, then run lifecycle and the full check once." });
    }
    return step("ship", { command: `${CLI} ship "<imperative message>" [--push]`, guidance: "The operator already approved this exact version at the preview. Save it and tell them it is saved, in plain language." });
  }
  if (quick) return step("finish", { skills: ["simplify", "handoff"], guidance: `Finish tests, simplify, and docs; stage everything; run lifecycle and verify --mode full; then handoff. Run ${CLI} next for the exact step.` });
  const receipt = readReceipt(cwd, "full");
  if (!staged.length || !receiptMatches(receipt, cwd, config, "staged")) {
    return step("finish", {
      command: `${CLI} lifecycle && ${CLI} verify --mode full`,
      skills: ["simplify"],
      guidance: [
        "Complete the remaining test coverage, apply simplify to the whole diff (SAFE and CAREFUL findings), and update the docs that describe the change.",
        "Stage the entire concern, run lifecycle and fix every finding, then run the full check once.",
        `If finishing work changes anything the operator can see, run ${CLI} revise and preview again.`,
      ].join("\n"),
    });
  }
  if (open.handoff?.receiptAt !== receipt.at) {
    return step("handoff", { command: `${CLI} handoff`, skills: ["handoff"], guidance: "Run handoff, finish the draft in the operator's language, send it, and stop." });
  }
  return step("await-approval", {
    waitFor: "operator",
    command: `${CLI} ship "<imperative message>" ${QUOTE} [--push]`,
    guidance: `Stop and wait. Only an explicit approval to save ("ship it") after the handoff counts. "Hold" or questions: keep reviewing. Visible changes: run ${CLI} revise.`,
  });
}

export function renderNext(next) {
  return [
    `Next: ${next.step}${next.waitFor === "operator" ? " (wait for the operator)" : ""}`,
    next.command ? `${next.waitFor === "operator" ? "When they reply" : "Run"}: ${next.command}` : "",
    next.skills.length ? `Read: ${next.skills.map((name) => `.agents/skills/${name}/SKILL.md`).join(", ")}` : "",
    next.guidance,
  ].filter(Boolean).join("\n");
}

function step(name, { waitFor = "agent", command = null, skills = [], guidance = "" } = {}) {
  return { step: name, waitFor, command, skills, guidance };
}

function briefCommand() {
  return `${CLI} brief --outcome "..." --accept "..." [--accept "..."] [--non-goal "..."] [--surface "..."]`;
}

function contextIsCurrent(cwd, session) {
  const packet = readContext(cwd);
  return Boolean(packet?.at && (!session.startedAt || packet.at >= session.startedAt));
}
