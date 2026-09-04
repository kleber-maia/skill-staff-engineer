// Free-text justifications recorded permanently as commit trailers.
export function validateReason(value, { min = 40, max = 500, minWords = 8, minDistinct = 6, name = "reason" } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false, error: `${name} is required.` };
  if (/\r|\n/.test(text)) return { ok: false, error: `${name} must be a single line.` };
  if (text.length < min || text.length > max) return { ok: false, error: `${name} must be ${min}–${max} characters.` };
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < minWords) return { ok: false, error: `${name} must have at least ${minWords} words.` };
  if (new Set(words).size < minDistinct) return { ok: false, error: `${name} must have at least ${minDistinct} distinct words.` };
  return { ok: true, value: text };
}

export function validateWaiver(value, name) {
  if (value === undefined || value === "") return { ok: false };
  return validateReason(value, { min: 20, max: 300, minWords: 5, minDistinct: 4, name });
}
