import { loadConfig } from "../lib/config.mjs";
import { ok, refused } from "../lib/output.mjs";
import { codeTreeFingerprint } from "../lib/receipt.mjs";
import { reproTestFiles, runRepro } from "../lib/repro.mjs";
import { CLI, PHASES, requireOpenSession, writeSession } from "../lib/session.mjs";
import { validateReason } from "../lib/waivers.mjs";

export const description = "Prove a bug fix: the reproduction test must fail on the original code and pass on the fixed code.";
export const usage = 'repro "<command that runs the reproducing test>"   |   repro --waiver "why this bug cannot be reproduced by a test"';

export default async function run({ cwd, positional, flags = {} }) {
  const config = loadConfig(cwd);
  const session = requireOpenSession(cwd);
  if (session.kind !== "bug") throw refused("Only bug fixes need a reproduction.", { agent: `Open bug fixes with ${CLI} begin "..." --bug.` });
  if (session.phase === PHASES.AWAITING_FEEDBACK) throw refused("The preview is waiting for the operator's feedback.", { agent: `Wait, or run ${CLI} revise first.` });

  if (flags.waiver !== undefined) {
    const reason = validateReason(flags.waiver, { name: "--waiver" });
    if (!reason.ok) throw refused("A reproduction waiver needs a real reason.", { agent: reason.error });
    writeSession(cwd, { ...session, repro: { waiver: reason.value, at: new Date().toISOString() } });
    return ok({ operator: "", agent: `Waiver recorded; it is saved with the change and must be repeated in the handoff. Run ${CLI} next.`, data: { waiver: reason.value } });
  }

  const command = positional.join(" ").trim();
  if (!command) throw refused("Name the command that runs the reproducing test.", { agent: `Usage: ${CLI} ${usage}` });
  if (!reproTestFiles(cwd, config, session).length) {
    throw refused("The reproduction must be a test added or changed in this concern.", { agent: "Write a test that shows the reported bug, then run repro with the command that runs it." });
  }
  const result = runRepro(cwd, config, session, command);
  if (result.base.setup) {
    throw refused("On the original code the test failed for a setup reason, not because of the bug.", {
      errors: [result.base.tail],
      agent: "Make the test exercise the bug through code that already existed (no new modules or tools), then run repro again.",
    });
  }
  if (result.base.ok) {
    throw refused("The test passes on the original code, so it does not reproduce the bug.", {
      agent: "Tighten the test until it fails the way the operator described, then run repro again.",
    });
  }
  const repro = { command, failsAtBase: true, passesNow: result.now.ok, at: new Date().toISOString(), codeTree: codeTreeFingerprint(cwd, config, "working").digest, baseTail: result.base.tail };
  writeSession(cwd, { ...session, repro });
  return ok({
    operator: "",
    agent: result.now.ok
      ? `Proof complete: the test fails on the original code and passes now. Failure on the original code (check it is the reported bug):\n${result.base.tail}\nRun ${CLI} next.`
      : `Reproduction confirmed: the test fails on the original code. It still fails now, so fix the bug and run repro again.\n${result.now.tail}`,
    data: { repro: { ...repro, baseTail: undefined }, now: result.now },
  });
}

// Current while the code is unchanged since the passing run.
export function reproIsCurrent(cwd, config, session, mode = "working") {
  const repro = session.repro;
  if (repro?.waiver) return true;
  return Boolean(repro?.failsAtBase && repro.passesNow && repro.codeTree === codeTreeFingerprint(cwd, config, mode).digest);
}

export function reproTrailers(repro) {
  if (!repro) return {};
  return repro.waiver ? { "Repro-Waiver": repro.waiver } : { Repro: `${repro.command} (fails before the fix, passes after)` };
}
