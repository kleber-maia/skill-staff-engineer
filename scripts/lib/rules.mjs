// Apply the language rule table to added lines of a parsed diff.
import { extname } from "node:path";

import { readJson } from "./fs-safe.mjs";
import { matchesAny } from "./glob.mjs";
import { classify } from "./paths.mjs";
import { assetPath } from "./toolkit.mjs";

let cachedTable = null;

export function loadLanguageRules() {
  cachedTable ??= readJson(assetPath("rules", "languages.json"));
  return cachedTable;
}

export function languageOf(file, table = loadLanguageRules()) {
  const ext = extname(file).toLowerCase();
  for (const [language, extensions] of Object.entries(table.extensions)) {
    if (extensions.includes(ext)) return language;
  }
  return null;
}

export function applyLineRules(config, parsedDiff, { table = loadLanguageRules(), exceptions = [] } = {}) {
  const disabled = new Set(config.rules.disable ?? []);
  const findings = [];
  for (const entry of parsedDiff) {
    if (entry.binary) continue;
    const kind = classify(config, entry.file);
    if (kind === "generated" || kind === "toolkit") continue;
    const language = languageOf(entry.file, table);
    const isTest = kind === "tests";
    const allowDebug = isTest || matchesAny(entry.file, config.paths.allowDebug ?? []);
    for (const rule of table.rules) {
      if (disabled.has(rule.id)) continue;
      if (!rule.languages.includes("*") && (!language || !rule.languages.includes(language))) continue;
      if (rule.id.startsWith("debug-") && allowDebug) continue;
      if (isExcepted(exceptions, rule.id, entry.file)) continue;
      const regexp = new RegExp(rule.pattern);
      for (const { line, text } of entry.added) {
        if (regexp.test(text)) {
          findings.push({ rule: rule.id, severity: rule.severity, file: entry.file, line, text: text.trim().slice(0, 160), message: rule.message });
        }
      }
    }
  }
  return findings;
}

export function isExcepted(exceptions, ruleId, file) {
  return exceptions.some((exception) => (exception.rule === ruleId || exception.rule === "*") && matchesAny(file, [exception.path]));
}
