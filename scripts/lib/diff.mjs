// Parse `git diff --cached --unified=0` into added lines per file.
export function parseUnifiedDiff(text) {
  const files = [];
  let current = null;
  let newLine = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith("diff --git ")) {
      current = { file: null, status: "M", added: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("new file mode")) current.status = "A";
    else if (raw.startsWith("deleted file mode")) current.status = "D";
    else if (raw.startsWith("rename to ")) current.status = "R";
    else if (raw.startsWith("+++ ")) {
      const target = raw.slice(4);
      current.file = target === "/dev/null" ? current.file : target.replace(/^b\//, "");
    } else if (raw.startsWith("--- ")) {
      const source = raw.slice(4);
      if (source !== "/dev/null" && !current.file) current.file = source.replace(/^a\//, "");
    } else if (raw.startsWith("@@")) {
      const match = /\+(\d+)(?:,(\d+))?/.exec(raw);
      newLine = match ? Number(match[1]) : 0;
    } else if (raw.startsWith("+")) {
      current.added.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith("Binary files")) {
      current.binary = true;
    }
  }
  return files.filter((entry) => entry.file && entry.status !== "D");
}
