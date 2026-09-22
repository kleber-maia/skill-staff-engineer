// Self-check before the operator looks: acceptance checks can carry a probe the
// CLI runs itself (no model tokens), and results are cached against the concern's
// content so an unchanged preview is never checked twice.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { runShell } from "./exec.mjs";
import { workingTreeHash } from "./git.mjs";
import { refused } from "./output.mjs";
import { sessionConcernFiles } from "./session.mjs";

const CHECK = /^(\d+)\s*:\s*(page|run)\s+(.+?)\s+contains\s+(.+)$/i;

// "2: page /orders contains Export" or "1: run npm run demo contains 6".
export function parseCheck(text, acceptCount) {
  const match = CHECK.exec(String(text ?? "").trim());
  const usage = 'Use --check "<acceptance number>: page <path> contains <text>" or --check "<acceptance number>: run <command> contains <text>".';
  if (!match) throw refused(`The automatic check "${text}" is not in a form the toolkit can run.`, { agent: usage });
  const accept = Number(match[1]) - 1;
  if (accept < 0 || accept >= acceptCount) throw refused(`The automatic check "${text}" names acceptance check ${match[1]}, which does not exist.`, { agent: usage });
  return { accept, kind: match[2].toLowerCase(), target: match[3].trim(), text: match[4].trim().replace(/^["']|["']$/g, "") };
}

// off: never. auto: probes outside the trivial lane. thorough: probes everywhere
// plus a look at screenshots that changed since the last round.
export function selfCheckPlan(level, lane) {
  return { probes: level === "thorough" || (level === "auto" && lane !== "trivial"), screenshots: level === "thorough" };
}

export function concernFingerprint(cwd, session) {
  const entries = sessionConcernFiles(session, cwd).sort().map((file) => [file, workingTreeHash(file, cwd)]);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

// Returns { cached, results, failures, fingerprint }.
export async function runProbes(cwd, config, session, { fetchImpl = fetch } = {}) {
  const checks = session.brief?.checks ?? [];
  const fingerprint = concernFingerprint(cwd, session);
  const previous = session.selfCheck;
  if (previous?.fingerprint === fingerprint && previous.results?.length === checks.length && previous.results.every((result) => result.ok)) {
    return { cached: true, results: previous.results, failures: [], fingerprint };
  }
  const results = [];
  for (const [index, check] of checks.entries()) results.push({ index, ...(await probe(cwd, config, check, fetchImpl)) });
  return { cached: false, results, failures: results.filter((result) => !result.ok), fingerprint };
}

async function probe(cwd, config, check, fetchImpl) {
  if (check.kind === "page") {
    if (config.preview?.kind !== "web") return { ok: false, detail: "page checks need a web preview" };
    try {
      const url = new URL(check.target, config.preview.url).href;
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
      const body = await response.text();
      if (response.status >= 400) return { ok: false, detail: `${check.target} answered ${response.status}` };
      return body.includes(check.text) ? { ok: true } : { ok: false, detail: `${check.target} does not contain "${check.text}"` };
    } catch (error) {
      return { ok: false, detail: `${check.target} could not be loaded (${error.message})` };
    }
  }
  const result = runShell(check.target, { cwd, timeoutMs: 120000 });
  if (!result.ok) return { ok: false, detail: `"${check.target}" exited with ${result.timedOut ? "a timeout" : result.status}` };
  return `${result.stdout}${result.stderr}`.includes(check.text) ? { ok: true } : { ok: false, detail: `"${check.target}" output does not contain "${check.text}"` };
}

// Screenshot hashes by name, and the names whose image changed since the last round.
export function screenshotChanges(files, previous = {}) {
  const hashes = Object.fromEntries(files.map((file) => [file.split(/[\\/]/).pop(), createHash("sha256").update(readFileSync(file)).digest("hex")]));
  const changed = files.filter((file) => previous[file.split(/[\\/]/).pop()] !== hashes[file.split(/[\\/]/).pop()]);
  return { hashes, changed };
}
