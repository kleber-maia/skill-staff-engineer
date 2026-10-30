import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { outputRaw, runShell } from "./exec.mjs";
import { nulPaths, stagedEntry } from "./git.mjs";
import { isVerificationDocumentation } from "./paths.mjs";

// Include both ends of renames and every index/worktree/untracked change.
export function verificationFiles(cwd, mode = "working") {
  return [...new Set([
    ...nulPaths(outputRaw("git", ["diff", "--cached", "--no-renames", "--name-only", "-z", "--"], { cwd })),
    ...(mode === "staged" ? [] : nulPaths(outputRaw("git", ["diff", "--no-renames", "--name-only", "-z", "--"], { cwd }))),
    ...(mode === "staged" ? [] : nulPaths(outputRaw("git", ["ls-files", "--others", "--exclude-standard", "-z", "--"], { cwd }))),
  ])].sort();
}

export function documentationFiles(cwd, config) {
  cwd = realpathSync(cwd);
  const files = verificationFiles(cwd);
  if (!files.length || outputRaw("git", ["ls-files", "--unmerged", "-z"], { cwd })) return null;
  return files.every(file => isPlainDocumentationFile(cwd, config, file)) ? files : null;
}

export function isPlainDocumentationFile(cwd, config, file) {
  cwd = realpathSync(cwd);
  if (!isVerificationDocumentation(config, file)) return false;
  const baseline = outputRaw("git", ["--literal-pathspecs", "ls-tree", "HEAD", "-z", "--", file], { cwd, allowFailure: true });
  if ((baseline && !baseline.startsWith("100644 ")) || (stagedEntry(file, cwd)?.mode ?? "100644") !== "100644") return false;
  const path = resolve(cwd, file);
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (error.code === "ENOENT") return Boolean(baseline);
    throw error;
  }
  if (!stat.isFile() || stat.mode & 0o111 || !inside(cwd, realpathSync(path))) return false;
  for (let parent = dirname(path); parent !== resolve(cwd); parent = dirname(parent)) {
    if (!inside(cwd, parent) || lstatSync(parent).isSymbolicLink()) return false;
  }
  const bytes = readFileSync(path);
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return false; }
  if (bytes.includes(0)) return false;
  return true;
}

export function checkDocumentation(cwd, files, config) {
  cwd = realpathSync(cwd);
  const started = Date.now();
  const errors = [];
  for (const command of ["git diff --check", "git diff --cached --check"]) {
    const result = runShell(command, { cwd, timeoutMs: 30000 });
    if (!result.ok) errors.push((result.stderr || result.stdout).trim());
  }
  const deleted = new Set(files.filter(file => !existsSync(resolve(cwd, file))).map(file => resolve(cwd, file)));
  const inbound = deleted.size ? nulPaths(outputRaw("git", ["ls-files", "-z", "--"], { cwd }))
    .filter(file => isPlainDocumentationFile(cwd, config, file) && !files.includes(file)) : [];
  for (const file of [...files, ...inbound]) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, "utf8");
    if (files.includes(file)) source.split(/\r?\n/).forEach((line, index) => {
      if (/[\t ]+$/.test(line)) errors.push(`${file}:${index + 1}: trailing whitespace`);
    });
    if (files.includes(file) && source && !source.endsWith("\n")) errors.push(`${file}: missing final newline`);
    if (!/\.md$/i.test(file)) continue;
    const prose = source.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*(?:\n|$)/gm, "")
      .replace(/(`+)[^\n]*?\1/g, "");
    const targets = markdownTargets(prose);
    targets.push(...[...prose.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm)].map(match => match[1]));
    for (const target of targets) {
      const error = checkTarget(cwd, path, target.replace(/^<|>$/g, "").replace(/\\([\\()])/g, "$1"), files.includes(file) ? null : deleted);
      if (error) errors.push(`${file}: ${error}`);
    }
  }
  return {
    name: "documentation", status: errors.length ? "failed" : "passed",
    command: "Built-in documentation whitespace, local-link and source-line checks",
    durationMs: Date.now() - started, exitStatus: errors.length ? 1 : 0,
    stdout: errors.length ? "" : `Checked ${files.length} documentation file(s); no application commands executed.`,
    stderr: errors.join("\n"),
  };
}

function markdownTargets(prose) {
  const targets = [];
  for (const match of prose.matchAll(/!?\[[^\]\n]*\]\(\s*/g)) {
    const start = match.index + match[0].length;
    if (prose[start] === "<") {
      const end = prose.indexOf(">", start + 1);
      if (end >= 0) targets.push(prose.slice(start + 1, end));
      continue;
    }
    let target = "", depth = 0;
    for (let index = start; index < prose.length; index++) {
      const character = prose[index];
      if (character === "\\" && index + 1 < prose.length) { target += character + prose[++index]; continue; }
      if (character === "(") depth++;
      if (character === ")") { if (depth === 0) break; depth--; }
      if (/\s/.test(character) && depth === 0) break;
      target += character;
    }
    targets.push(target);
  }
  return targets;
}

function checkTarget(cwd, source, target, onlyTargets) {
  if (/^(?:https?:|mailto:|tel:|data:)/i.test(target) || target.startsWith("//")) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return `unsupported local link ${target}`;
  const [raw, fragment = ""] = target.split("#", 2);
  let decoded;
  try { decoded = decodeURIComponent(raw.split("?", 1)[0]); } catch { return `invalid link encoding ${target}`; }
  const path = decoded ? resolve(decoded.startsWith("/") ? cwd : dirname(source), decoded.replace(/^\//, "")) : source;
  if (onlyTargets && !onlyTargets.has(path)) return null;
  if (!inside(cwd, path) || (existsSync(path) && !inside(cwd, realpathSync(path)))) return `link escapes the repository: ${target}`;
  if (!existsSync(path)) return `missing local link ${target}`;
  const lines = /^L(\d+)(?:-L(\d+))?$/.exec(fragment);
  if (lines) {
    if (!lstatSync(path).isFile()) return `source line link is not a file: ${target}`;
    const content = readFileSync(path, "utf8");
    const count = content.split(/\r?\n/).length - Number(content.endsWith("\n"));
    if (+lines[1] < 1 || +(lines[2] ?? lines[1]) < +lines[1] || +(lines[2] ?? lines[1]) > count) return `invalid source line range ${target}`;
  }
  return null;
}

function inside(cwd, path) {
  const rel = relative(resolve(cwd), path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep);
}
