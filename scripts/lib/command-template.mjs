// Validate affected-test command templates before file references are inserted.
// {files} must be a complete shell token outside quotes/comments. Shell command
// evaluators are excluded because they can reinterpret positional data as code.
const SHELL_EVALUATORS = new Set(["sh", "sh.exe", "bash", "bash.exe", "zsh", "zsh.exe", "dash", "dash.exe", "ksh", "ksh.exe", "fish", "fish.exe", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"]);

export function validateAffectedCommandTemplate(value) {
  if (typeof value !== "string") return { ok: false, error: "must be a string" };
  const occurrences = [...value.matchAll(/\{files\}/g)];
  if (occurrences.length !== 1) return { ok: false, error: "must contain exactly one {files} placeholder" };
  const index = occurrences[0].index;
  const context = shellContextAt(value, index);
  if (context.quote || context.comment || context.depth > 0) return { ok: false, error: "{files} must be a top-level token outside shell quotes, comments, and command groups" };
  const before = value[index - 1];
  const after = value[index + "{files}".length];
  if ((before !== undefined && (!/\s/.test(before) || isEscapedWhitespace(value, index - 1))) || (after !== undefined && !/\s/.test(after))) {
    return { ok: false, error: "{files} must be a standalone shell token" };
  }
  const segment = commandSegmentAt(value, index);
  const words = shellWords(segment);
  if (words.some((word) => ["eval", "call"].includes(commandName(word)))) {
    return { ok: false, error: "{files} is not supported with eval or call" };
  }
  const executable = effectiveExecutable(words);
  if (executable && /[$`%!]/.test(executable)) return { ok: false, error: "{files} requires a static executable name" };
  for (let index = 0; index < words.length; index += 1) {
    const executable = commandName(words[index]);
    const flags = words.slice(index + 1).map((word) => word.toLowerCase());
    if (SHELL_EVALUATORS.has(executable) && flags.some((flag) => isEvaluationFlag(executable, flag))) {
      return { ok: false, error: "{files} is not supported in a shell command-evaluation template" };
    }
  }
  return { ok: true, error: null };
}

function isEscapedWhitespace(value, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function isEvaluationFlag(executable, flag) {
  if (executable === "cmd" || executable === "cmd.exe") return flag === "/c";
  if (executable.startsWith("power") || executable.startsWith("pwsh")) {
    return flag.startsWith("-c") || flag.startsWith("-e");
  }
  return /^-[a-z]*c[a-z]*$/i.test(flag);
}

function shellContextAt(value, stop) {
  let quote = null;
  let escaped = false;
  let comment = false;
  let depth = 0;
  for (let index = 0; index < stop; index += 1) {
    const char = value[index];
    if (comment) {
      if (char === "\n" || char === "\r") comment = false;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s|[;&|()]/.test(value[index - 1]))) comment = true;
    else if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
  }
  return { quote, comment, depth };
}

function commandSegmentAt(value, stop) {
  let start = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < stop; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === ";" || char === "|" || char === "&" || char === "\n" || char === "\r") start = index + 1;
  }
  return value.slice(start, stop);
}

function shellWords(value) {
  const words = [];
  let word = "";
  let quote = null;
  let escaped = false;
  const flush = () => {
    if (word) words.push(word);
    word = "";
  };
  for (const char of value) {
    if (escaped) {
      word += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      word += char;
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (/\s/.test(char)) flush();
    else word += char;
  }
  flush();
  return words;
}

function commandName(word) {
  return word.replaceAll("\\", "/").split("/").at(-1).toLowerCase();
}

function effectiveExecutable(words) {
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) index += 1;
  if (commandName(words[index] ?? "") === "env") {
    index += 1;
    while (index < words.length && (words[index].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]))) index += 1;
  }
  if (commandName(words[index] ?? "") === "command") index += 1;
  return words[index] ?? "";
}
