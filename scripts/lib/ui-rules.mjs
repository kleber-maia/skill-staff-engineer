// UI finish rules applied to added lines of user-facing files.
import { extname } from "node:path";

import { readJson } from "./fs-safe.mjs";
import { classify } from "./paths.mjs";
import { isExcepted } from "./rules.mjs";
import { assetPath } from "./toolkit.mjs";

let cached = null;

export function loadUiRules() {
  cached ??= readJson(assetPath("rules", "ui.json"));
  return cached;
}

export function uiFileKind(file, table = loadUiRules()) {
  const ext = extname(file).toLowerCase();
  if (table.componentExtensions.includes(ext)) return "components";
  if (table.styleExtensions.includes(ext)) return "styles";
  return null;
}

export function isUiFile(file) {
  return uiFileKind(file) !== null;
}

export function uiRulesEnabled(config) {
  const setting = config.rules?.ui?.enabled;
  return setting !== false && setting !== "off";
}

export function applyUiRules(config, parsedDiff, { table = loadUiRules(), exceptions = [] } = {}) {
  if (!uiRulesEnabled(config)) return [];
  const disabled = new Set(config.rules.disable ?? []);
  const findings = [];
  for (const entry of parsedDiff) {
    if (entry.binary) continue;
    const kind = uiFileKind(entry.file, table);
    if (!kind) continue;
    const classification = classify(config, entry.file);
    if (["tests", "generated", "toolkit"].includes(classification)) continue;
    for (const rule of table.rules) {
      if (disabled.has(rule.id)) continue;
      if (rule.appliesTo !== "all" && rule.appliesTo !== kind) continue;
      if (isExcepted(exceptions, rule.id, entry.file)) continue;
      const regexp = new RegExp(rule.pattern, rule.flags ?? "");
      for (const { line, text } of entry.added) {
        if (regexp.test(text)) {
          findings.push({ rule: rule.id, severity: rule.severity, file: entry.file, line, text: text.trim().slice(0, 160), message: rule.message });
        }
      }
    }
  }
  return findings;
}
