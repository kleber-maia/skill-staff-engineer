// Narrow lexical checks, not a JavaScript parser or a measure of test value.
import { output } from "./exec.mjs";
import { isGenerated, isTestFile, isToolkitPath } from "./paths.mjs";
import { isExcepted } from "./rules.mjs";

const messages = {
  "test-class-equality": "Assert observable state, geometry, or an intentional semantic class instead of comparing the whole class attribute.",
  "test-theme-no-op": "Assert the opposite of the initial theme; accepting either light or dark cannot detect a broken toggle.",
};

export function testQualityFindings(file, source) {
  const tokens = tokenize(source);
  const findings = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].value !== "expect" || tokens[index].kind !== "word" || tokens[index - 1]?.value === "." || tokens[index + 1]?.value !== "(") continue;
    const end = closingParen(tokens, index + 1);
    if (end < 0 || tokens[end + 1]?.value !== "." || tokens[end + 3]?.value !== "(") continue;
    const matcher = tokens[end + 2]?.value;
    const argument = tokens[end + 4];
    let rule;
    if (matcher === "toHaveAttribute" && argument?.kind === "string" && argument.value === "class"
      && tokens[end + 5]?.value === "," && ![undefined, ")"].includes(tokens[end + 6]?.value)) rule = "test-class-equality";
    if (matcher === "toHaveClass" && argument?.kind === "regex" && ["/dark|light/", "/light|dark/"].includes(argument.value)) rule = "test-theme-no-op";
    const assertionEnd = closingParen(tokens, end + 3);
    if (rule && assertionEnd >= 0) findings.push({ rule, severity: "block", file, line: tokens[index].line, endLine: tokens[assertionEnd].line, message: messages[rule] });
  }
  return findings;
}

export function checkTestQuality(cwd, config, parsedDiff, { exceptions = [] } = {}) {
  const disabled = new Set(config.rules.disable ?? []);
  return parsedDiff.flatMap((entry) => {
    if (entry.binary || !entry.added.length || !/\.[cm]?[jt]sx?$/i.test(entry.file)
      || !isTestFile(config, entry.file) || isGenerated(config, entry.file) || isToolkitPath(entry.file)) return [];
    const source = output("git", ["show", `:${entry.file}`], { cwd });
    return testQualityFindings(entry.file, source).filter((finding) => !disabled.has(finding.rule)
      && !isExcepted(exceptions, finding.rule, entry.file)
      && entry.added.some(({ line }) => line >= finding.line && line <= finding.endLine));
  });
}

function closingParen(tokens, start) {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    if (tokens[index].value === "(" && tokens[index].kind === "punctuation") depth++;
    if (tokens[index].value === ")" && tokens[index].kind === "punctuation" && --depth === 0) return index;
  }
  return -1;
}

function tokenize(source) {
  const tokens = [];
  // Quoted and template strings are consumed whole, including escaped delimiters.
  // Template interpolation and unusual JS syntax intentionally remain review work.
  const pattern = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\])+\/[a-z]*|[\w$]+|[^\s]/gy;
  let line = 1;
  for (const match of source.matchAll(pattern)) {
    const value = match[0];
    const startLine = line;
    line += (value.match(/\n/g) ?? []).length;
    if (/^\s|^\/\/|^\/\*/.test(value)) continue;
    const kind = /^["'`]/.test(value) ? "string" : value.startsWith("/") && value.length > 1 ? "regex" : /^[\w$]/.test(value) ? "word" : "punctuation";
    tokens.push({ value: kind === "string" ? value.slice(1, -1) : value, kind, line: startLine });
  }
  return tokens;
}
