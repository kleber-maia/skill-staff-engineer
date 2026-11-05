// Reproduce against an independent disposable repository at the base commit.
// Only this concern's tests and explicit test drivers are overlaid; product fixes
// and ignored data stay out. No Git worktree is registered in the original repo.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";

import { output, runShell } from "./exec.mjs";
import { assertInsideRoot } from "./fs-safe.mjs";
import { normalize } from "./glob.mjs";
import { classify, isDocumentable, isProtected, isNeverStage, isToolkitPath } from "./paths.mjs";
import { refused } from "./output.mjs";
import { sessionConcernFiles } from "./session.mjs";

export const REPRO_VERSION = 2;
export const DEFAULT_REPRO_TIMEOUT_MS = 5 * 60 * 1000;
const SETUP_FAILURE = /cannot find module|err_module_not_found|modulenotfounderror|no module named|command not found|is not recognized as an internal or external command|no such file or directory|enoent|(?:unknown|unrecognized|invalid|unsupported) (?:option|argument|command|test method)|--[\w-]+ needs (?:a |an )?(?:known|valid)\b|no tests? (?:were )?found|build failed|compilation failed|syntaxerror/i;

export function reproTestFiles(cwd, config, session) {
  return sessionConcernFiles(session, cwd).filter((file) => classify(config, file) === "tests");
}

export function reproOptions(cwd, config, session, flags = {}) {
  const expectedFailure = flags["expect-failure"];
  if (typeof expectedFailure !== "string" || expectedFailure.trim().length < 8 || expectedFailure.length > 2000 || /[\r\n\0]/.test(expectedFailure)) {
    throw refused("Name the specific expected test failure with --expect-failure (8–2000 characters, one line).", { agent: "Use a literal diagnostic tied to the reported bug, not a generic command failure or setup error." });
  }
  const timeoutMs = Number(flags["timeout-ms"] ?? DEFAULT_REPRO_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60 * 60 * 1000) throw refused("--timeout-ms must be an integer between 1000 and 3600000; include build and runtime time.");
  return { expectedFailure: expectedFailure.trim(), timeoutMs, supportFiles: validateSupportFiles(cwd, config, session, flags["support-file"] ?? []) };
}

function validateSupportFiles(cwd, config, session, files) {
  const changed = new Set(sessionConcernFiles(session, cwd));
  return [...new Set(files.map((file) => {
    if (typeof file !== "string" || !file || /[\r\n\0]/.test(file) || isAbsolute(file) || /^[a-z]:/i.test(file) || file.replaceAll("\\", "/").split("/").includes("..")) throw refused("Each --support-file must be a changed repository-relative test-driver file.");
    file = normalize(file);
    const path = assertInsideRoot(cwd, file);
    if (!changed.has(file) || !isDocumentable(config, file) || isToolkitPath(file) || isProtected(config, file) || isNeverStage(config, file) || !existsSync(path) || !lstatSync(path).isFile()) {
      throw refused(`Not an eligible changed test driver: ${file}.`, { agent: "Support files must be regular changed operational files under paths.documentable, never product source, toolkit code, secrets or directories. Copy only test-launch infrastructure, never the product fix." });
    }
    return file;
  }))];
}

// Setup detection and diagnostic matching use the complete output, not its tail.
export function summarizeRepro(result, expectedFailure = "") {
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const incomplete = Boolean(result.timedOut || result.error || !Number.isInteger(result.status) || result.status >= 128);
  const setup = !result.ok && (incomplete || [126, 127].includes(result.status) || SETUP_FAILURE.test(text));
  return { ok: result.ok && !incomplete, status: result.status, timedOut: Boolean(result.timedOut), error: result.error ?? null, incomplete, setup, expectedFailureMatched: !result.ok && !setup && Boolean(expectedFailure) && text.includes(expectedFailure), tail: text.split("\n").slice(-25).join("\n") };
}

export function hasBaseProof(repro) {
  if (repro?.waiver) return true;
  return Boolean(repro?.version === REPRO_VERSION && repro.failsAtBase && repro.expectedFailure
    && repro.base?.ok === false && repro.base.expectedFailureMatched && !repro.base.setup && !repro.base.incomplete && Number.isInteger(repro.base.status) && repro.base.status > 0 && repro.base.status < 128);
}

export function runRepro(cwd, config, session, command, { expectedFailure = "", timeoutMs = DEFAULT_REPRO_TIMEOUT_MS, supportFiles = [] } = {}) {
  const testFiles = reproTestFiles(cwd, config, session);
  supportFiles = validateSupportFiles(cwd, config, session, supportFiles);
  const now = summarizeRepro(runShell(command, { cwd, timeoutMs }), expectedFailure);
  // A broken or interrupted current harness cannot support a baseline comparison.
  if (now.setup || (!now.ok && expectedFailure && !now.expectedFailureMatched)) return { base: null, now, testFiles, supportFiles };
  const base = withBaseRepository(cwd, config, session.baseCommit, (dir, env) => {
    for (const file of [...new Set([...testFiles, ...supportFiles])]) {
      const from = assertInsideRoot(cwd, file);
      const target = assertInsideRoot(dir, file);
      if (existsSync(from)) {
        if (!lstatSync(from).isFile()) throw refused(`Reproduction inputs must be regular files: ${file}.`);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(from, target);
      } else rmSync(target, { force: true });
    }
    return summarizeRepro(runShell(command, { cwd: dir, env, timeoutMs }), expectedFailure);
  });
  return { base, now, testFiles, supportFiles, isolation: "independent-repository" };
}

function withBaseRepository(cwd, config, commit, run) {
  const dir = mkdtempSync(join(tmpdir(), "staff-engineer-repro-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  const git = (args) => output("git", args, { env });
  try {
    git(["init", "--quiet", dir]);
    git(["-C", dir, "config", "gc.auto", "0"]);
    git(["-C", dir, "config", "maintenance.auto", "false"]);
    // A local shallow fetch creates independent objects and no origin remote.
    git(["-C", dir, "fetch", "--quiet", "--no-tags", "--depth", "1", cwd, commit]);
    git(["-C", dir, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
    copyDependencies(cwd, dir, config, env);
    return run(dir, env);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Only known dependency directories enter the base checkout. Copies are disposable:
// neither a test write nor an absolute/outside symlink can reach the original data.
function copyDependencies(cwd, dir, config, env) {
  for (const name of ["node_modules", ".venv", "venv", "vendor"]) {
    const source = join(cwd, name);
    if (!existsSync(source) || lstatSync(source).isSymbolicLink() || !lstatSync(source).isDirectory()) continue;
    if (!output("git", ["check-ignore", "--", name], { cwd, env, allowFailure: true })) continue;
    const canonicalSource = realpathSync.native(source);
    cpSync(source, join(dir, name), { recursive: true, dereference: true, filter: (path) => {
      const rel = relative(cwd, path).replaceAll("\\", "/");
      let canonical;
      try { canonical = realpathSync.native(path); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
      const target = relative(canonicalSource, canonical);
      return !target.startsWith("..") && !isAbsolute(target) && !isProtected(config, rel) && !isNeverStage(config, rel);
    } });
  }
}
