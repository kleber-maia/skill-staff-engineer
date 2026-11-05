import { loadConfig } from "../lib/config.mjs";
import { ok, refused } from "../lib/output.mjs";
import { codeTreeFingerprint } from "../lib/receipt.mjs";
import { hasBaseProof, REPRO_VERSION, reproOptions, reproTestFiles, runRepro } from "../lib/repro.mjs";
import { CLI, PHASES, requireOpenSession, writeSession } from "../lib/session.mjs";
import { validateReason } from "../lib/waivers.mjs";

export const description = "Prove the expected bug failure on original code and a pass on fixed code, using independent baseline isolation.";
export const usage = 'repro "<test command>" --expect-failure "<specific diagnostic>" [--support-file <changed driver>] [--timeout-ms <ms>] | repro --waiver "<reason>"';

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
  if (!reproTestFiles(cwd, config, session).length) throw refused("The reproduction must be a test added or changed in this concern.", { agent: "Write a test that shows the reported bug, then run repro with the command that runs it." });
  const options = reproOptions(cwd, config, session, flags);
  // A rejected, interrupted or failed new attempt cannot retain an earlier proof.
  writeSession(cwd, { ...session, repro: { version: REPRO_VERSION, command, ...options, status: "running", at: new Date().toISOString() } });
  const result = runRepro(cwd, config, session, command, options);
  if (result.now.incomplete || result.base?.incomplete) throw refused("The reproduction did not finish normally; interruption, timeout or execution failure is not bug proof.", { agent: "Resolve the interruption or execution error and rerun. Use --timeout-ms to budget build plus runtime explicitly; do not treat an interrupted capture as a product assertion.", data: result });
  if (result.now.setup || result.base?.setup) throw refused("The test failed for a setup reason, not because of the bug.", { errors: [result.now.setup ? result.now.tail : result.base.tail], agent: "Fix the test harness. For a changed wrapper/allowlist, declare its changed operational file with --support-file; never copy the product fix into the baseline.", data: result });
  if (result.base?.ok) throw refused("The test passes on the original code, so it does not reproduce the bug.", { agent: "Tighten the test until it fails the way the operator described, then run repro again." });
  if (!result.base?.expectedFailureMatched || (!result.now.ok && !result.now.expectedFailureMatched)) throw refused("The failure does not match the expected bug diagnostic, so no proof was recorded.", { agent: "Inspect the actual failure. Use a specific assertion diagnostic tied to the reported bug; unrelated failures are not evidence.", data: result });
  const repro = { version: REPRO_VERSION, command, ...options, isolation: result.isolation, failsAtBase: true, passesNow: result.now.ok, base: result.base, at: new Date().toISOString(), codeTree: codeTreeFingerprint(cwd, config, "working").digest, baseTail: result.base.tail };
  writeSession(cwd, { ...session, repro });
  return ok({ operator: "", agent: result.now.ok
    ? `Proof complete: the expected test failure occurs on original code and the test passes now. Original failure:\n${result.base.tail}\nRun ${CLI} next.`
    : `Reproduction confirmed: the expected bug failure occurs on original code and still occurs now. Fix the bug and rerun with the same expected diagnostic and drivers.\n${result.now.tail}`,
    data: { repro: { ...repro, baseTail: undefined }, now: result.now } });
}

export function reproIsCurrent(cwd, config, session, mode = "working") {
  const repro = session.repro;
  if (repro?.waiver) return true;
  return Boolean(hasBaseProof(repro) && repro.passesNow && repro.codeTree === codeTreeFingerprint(cwd, config, mode).digest);
}

export function reproTrailers(repro) {
  if (!repro) return {};
  return repro.waiver ? { "Repro-Waiver": repro.waiver } : {
    Repro: `${repro.command} (fails before the fix, passes after)`,
    "Repro-Expected-Failure": repro.expectedFailure,
    "Repro-Isolation": repro.isolation,
    "Repro-Timeout-Ms": String(repro.timeoutMs),
    ...(repro.supportFiles?.length ? { "Repro-Support-Files": repro.supportFiles.join(", ") } : {}),
  };
}
