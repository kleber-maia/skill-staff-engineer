// Managed blocks: the only region of a user-owned file the toolkit ever edits.
export const HTML = Object.freeze({ open: "<!-- ", close: " -->" });
export const HASH = Object.freeze({ open: "# ", close: "" });

export function markers(name, style = HTML) {
  return { start: `${style.open}${name}:start${style.close}`, end: `${style.open}${name}:end${style.close}` };
}

export function hasBlock(text, name, style = HTML) {
  const { start, end } = markers(name, style);
  return typeof text === "string" && text.includes(start) && text.includes(end);
}

// Returns { text, action } where action is created | replaced | unchanged | appended.
export function upsertBlock(text, name, content, style = HTML) {
  const { start, end } = markers(name, style);
  const block = `${start}\n${content.trim()}\n${end}`;
  if (text == null) return { text: `${block}\n`, action: "created" };
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const existing = text.slice(startIndex, endIndex + end.length);
    if (existing === block) return { text, action: "unchanged" };
    return { text: `${text.slice(0, startIndex)}${block}${text.slice(endIndex + end.length)}`, action: "replaced" };
  }
  const separator = text.length === 0 ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return { text: `${text}${separator}${block}\n`, action: "appended" };
}

export function removeBlock(text, name, style = HTML) {
  if (!hasBlock(text, name, style)) return { text, action: "unchanged" };
  const { start, end } = markers(name, style);
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end) + end.length;
  let before = text.slice(0, startIndex);
  let after = text.slice(endIndex);
  if (after.startsWith("\n")) after = after.slice(1);
  before = before.replace(/\n{2,}$/, "\n");
  const result = `${before}${after}`;
  return { text: result.trim().length ? result : "", action: "removed" };
}
