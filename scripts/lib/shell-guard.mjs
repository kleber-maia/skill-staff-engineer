// Recognize ordinary shell invocations for early feedback. This is deliberately
// not a shell interpreter or a security boundary; the CLI validates the final batch.
export function shellCommands(command) {
  const commands = [];
  let words = [], word = "", quote = null, escaped = false;
  const flush = () => { if (word) words.push(word); word = ""; };
  const finish = () => { flush(); if (words.length) commands.push(words); words = []; };
  for (const char of command) {
    if (escaped) { word += char; escaped = false; continue; }
    if (char === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = null; else word += char; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (/[;&|\n\r]/.test(char)) finish();
    else if (/[<>]/.test(char)) { flush(); words.push(char); }
    else if (/\s/.test(char)) flush();
    else word += char;
  }
  finish();
  return commands;
}

export function gitInvocation(words) {
  // Only the executable is Git; arguments to searches and output commands are not.
  let index = 0;
  const wrappers = { env: ["-u", "--unset", "-C", "--chdir"], command: [], exec: ["-a"], sudo: ["-u", "--user", "-g", "--group"] };
  while (index < words.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) { index += 1; continue; }
    const wrapper = words[index]?.split(/[/\\]/).at(-1);
    if (!Object.hasOwn(wrappers, wrapper)) break;
    index += 1;
    while (words[index]?.startsWith("-")) {
      if (wrapper === "command" && ["-v", "-V"].includes(words[index])) return null;
      index += wrappers[wrapper].includes(words[index]) ? 2 : 1;
    }
  }
  if (!/(?:^|[/\\])git(?:\.exe)?$/.test(words[index] ?? "")) return null;
  let cursor = index + 1;
  while (words[cursor]?.startsWith("-")) {
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"].includes(words[cursor])) cursor += 2;
    else cursor += 1;
  }
  return { subcommand: words[cursor], args: words.slice(cursor + 1), normalized: ["git", ...words.slice(cursor)].join(" ") };
}

export function writeTargets(words) {
  const targets = [];
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] === ">") {
      while (words[index + 1] === ">") index += 1;
      if (words[index + 1]) targets.push(words[index + 1]);
    }
  }
  const command = words[0]?.split(/[/\\]/).at(-1);
  const args = words.slice(1).filter((word) => !word.startsWith("-"));
  if (["cp", "mv", "install"].includes(command) && args.length) targets.push(args.at(-1));
  if (["tee", "rm", "truncate", "touch"].includes(command)) targets.push(...args);
  if (command === "sed" && words.some((word) => word.startsWith("-i"))) targets.push(args.at(-1));
  return targets.filter(Boolean);
}
