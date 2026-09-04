import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { validateBoundaryRules } from "./boundaries.mjs";
import { readJson, writeJson } from "./fs-safe.mjs";
import { tooling } from "./output.mjs";

export const TOOLKIT_DIR = ".staff-engineer";
export const CONFIG_FILE = `${TOOLKIT_DIR}/config.json`;
export const CONFIG_VERSION = 1;
export const GATE_NAMES = ["install", "format", "lint", "typecheck", "test", "e2e", "build"];
export const PREVIEW_KINDS = ["web", "command", "manual"];
export const OPERATOR_MODES = ["non-technical", "technical"];

export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    toolkitVersion: "0.0.0",
    operator: { mode: "non-technical" },
    languages: [],
    packageManager: null,
    gates: {},
    preview: { kind: "manual", screenshots: "auto", screenshotPaths: ["/"] },
    paths: {
      source: [],
      tests: ["**/*.test.*", "**/*.spec.*", "**/*_test.*", "tests/**", "test/**", "__tests__/**", "spec/**"],
      docs: ["**/*.md", "docs/**"],
      generated: ["node_modules/**", "dist/**", "build/**", "coverage/**", ".next/**", "target/**", "__pycache__/**", "*.lock", "*-lock.json", "*.lockb"],
      protected: [".env", ".env.*", "**/*.pem", "**/*.key", "**/id_rsa*", "**/*.p12", "**/*.keystore"],
      neverStage: [".env", ".env.*", "**/*.pem", "**/*.key", "*.log", "coverage/**", ".staff-engineer/backups/**"],
      allowDebug: ["scripts/**", "bin/**", "cmd/**", "tools/**", ".staff-engineer/**"],
    },
    rules: {
      maxAddedLinesPerFile: 300,
      requireTestPerSourceChange: true,
      requireDocsImpact: true,
      maxConcernCategories: 2,
      requireSession: "warn",
      disable: [],
      ui: { enabled: "auto" },
      boundaries: [],
      importAliases: { "@/": "src/", "~/": "src/" },
    },
    exceptionsFile: `${TOOLKIT_DIR}/exceptions.json`,
  };
}

export function configPath(root) {
  return resolve(root, CONFIG_FILE);
}

export function hasConfig(root) {
  return existsSync(configPath(root));
}

export function loadConfig(root) {
  const path = configPath(root);
  if (!existsSync(path)) {
    throw tooling("The staff-engineer toolkit is not installed in this project yet.", {
      agent: "Run the installer (see the install skill): `node <toolkit>/scripts/cli.mjs install --target .` or `/staff-engineer:install`.",
    });
  }
  const raw = readJson(path);
  const config = mergeConfig(defaultConfig(), raw);
  const errors = validateConfig(config);
  if (errors.length) {
    throw tooling(`The toolkit configuration at ${CONFIG_FILE} is invalid.`, { errors, agent: errors.join("\n") });
  }
  return config;
}

export function saveConfig(root, config) {
  writeJson(configPath(root), config);
}

// Defaults fill missing keys only; arrays and gate objects from the file win entirely.
export function mergeConfig(defaults, overrides = {}) {
  const merged = { ...defaults, ...overrides };
  merged.operator = { ...defaults.operator, ...(overrides.operator ?? {}) };
  merged.paths = { ...defaults.paths, ...(overrides.paths ?? {}) };
  merged.rules = { ...defaults.rules, ...(overrides.rules ?? {}) };
  merged.preview = { ...defaults.preview, ...(overrides.preview ?? {}) };
  merged.gates = { ...(overrides.gates ?? {}) };
  return merged;
}

export function validateConfig(config) {
  const errors = [];
  if (config.version !== CONFIG_VERSION) errors.push(`version must be ${CONFIG_VERSION}`);
  if (!OPERATOR_MODES.includes(config.operator?.mode)) errors.push(`operator.mode must be one of ${OPERATOR_MODES.join(", ")}`);
  if (!PREVIEW_KINDS.includes(config.preview?.kind)) errors.push(`preview.kind must be one of ${PREVIEW_KINDS.join(", ")}`);
  if (config.preview?.kind === "web" && !config.preview.url) errors.push("preview.url is required when preview.kind is web");
  if (config.preview?.kind === "command" && !config.preview.cmd) errors.push("preview.cmd is required when preview.kind is command");
  for (const [name, gate] of Object.entries(config.gates ?? {})) {
    if (!GATE_NAMES.includes(name)) errors.push(`gates.${name} is not a known gate (${GATE_NAMES.join(", ")})`);
    if (gate !== null && (typeof gate !== "object" || typeof gate.cmd !== "string" || !gate.cmd.trim())) {
      errors.push(`gates.${name} must be null or an object with a non-empty "cmd" string`);
    }
  }
  for (const key of Object.keys(config.paths ?? {})) {
    if (!Array.isArray(config.paths[key])) errors.push(`paths.${key} must be an array of globs`);
  }
  if (!["warn", "block", "off"].includes(config.rules?.requireSession)) errors.push("rules.requireSession must be warn, block, or off");
  if (!Number.isInteger(config.rules?.maxAddedLinesPerFile) || config.rules.maxAddedLinesPerFile < 1) errors.push("rules.maxAddedLinesPerFile must be a positive integer");
  if (!Number.isInteger(config.rules?.maxConcernCategories) || config.rules.maxConcernCategories < 1) errors.push("rules.maxConcernCategories must be a positive integer");
  if (config.rules?.boundaries !== undefined) errors.push(...validateBoundaryRules(config.rules.boundaries));
  if (config.preview?.screenshotPaths !== undefined && !Array.isArray(config.preview.screenshotPaths)) errors.push("preview.screenshotPaths must be an array of paths");
  return errors;
}

// "run" (object), "na" (null, confirmed not applicable), "unknown" (missing key).
export function gateStatus(config, name) {
  if (!Object.hasOwn(config.gates ?? {}, name)) return "unknown";
  return config.gates[name] === null ? "na" : "run";
}

export function getPath(target, dotpath) {
  return dotpath.split(".").reduce((cursor, key) => (cursor == null ? undefined : cursor[key]), target);
}

export function setPath(target, dotpath, value) {
  const keys = dotpath.split(".");
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    if (cursor[key] == null || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys.at(-1)] = value;
  return target;
}

export function unsetPath(target, dotpath) {
  const keys = dotpath.split(".");
  const parent = getPath(target, keys.slice(0, -1).join(".")) ?? (keys.length === 1 ? target : undefined);
  if (parent && typeof parent === "object") delete parent[keys.at(-1)];
  return target;
}

// CLI values arrive as strings; accept JSON when it parses, else keep the string.
export function coerceValue(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^[[{"]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

export function isNonTechnical(config) {
  return config.operator?.mode !== "technical";
}
