// Personal, machine-local preferences. They live in the git state directory, so
// they are never committed, and only cover choices that cannot change what the
// full check verifies. The agent changes them when the operator asks.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readJson, writeJson } from "./fs-safe.mjs";
import { stateDir } from "./git.mjs";
import { refused } from "./output.mjs";

export const SELF_CHECK_LEVELS = ["off", "auto", "thorough"];

export const SETTINGS = {
  "updates.checkEveryHours": {
    default: 24,
    description: "Hours between upstream toolkit checks at begin (0 checks every time).",
    parse: (value) => {
      const hours = Number(value);
      if (!Number.isInteger(hours) || hours < 0 || hours > 24 * 90) throw new Error("must be a whole number of hours between 0 and 2160");
      return hours;
    },
  },
  "updates.offline": {
    default: null,
    description: "fail or allow when the upstream check is unreachable (unset follows the project config).",
    parse: (value) => {
      if (!["fail", "allow"].includes(value)) throw new Error("must be fail or allow");
      return value;
    },
  },
  "preview.selfCheck": {
    default: "auto",
    description: "How much the agent checks its own preview: off, auto (free probes outside the trivial lane), thorough (probes in every lane plus a look at changed screenshots).",
    parse: (value) => {
      if (!SELF_CHECK_LEVELS.includes(value)) throw new Error(`must be one of ${SELF_CHECK_LEVELS.join(", ")}`);
      return value;
    },
  },
};

export function settingsPath(cwd) {
  return join(stateDir(cwd), "settings.json");
}

function readStored(cwd) {
  const path = settingsPath(cwd);
  return existsSync(path) ? readJson(path, {})?.values ?? {} : {};
}

export function getSetting(cwd, key) {
  assertKey(key);
  const stored = readStored(cwd);
  return Object.hasOwn(stored, key) ? stored[key] : SETTINGS[key].default;
}

export function allSettings(cwd) {
  const stored = readStored(cwd);
  return Object.fromEntries(Object.entries(SETTINGS).map(([key, spec]) => [key, { value: Object.hasOwn(stored, key) ? stored[key] : spec.default, local: Object.hasOwn(stored, key), description: spec.description }]));
}

export function setSetting(cwd, key, raw) {
  assertKey(key);
  let value;
  try {
    value = SETTINGS[key].parse(String(raw ?? "").trim());
  } catch (error) {
    throw refused(`${key} ${error.message}.`);
  }
  writeJson(settingsPath(cwd), { version: 1, values: { ...readStored(cwd), [key]: value } });
  return value;
}

export function unsetSetting(cwd, key) {
  assertKey(key);
  const { [key]: _removed, ...rest } = readStored(cwd);
  writeJson(settingsPath(cwd), { version: 1, values: rest });
  return SETTINGS[key].default;
}

function assertKey(key) {
  if (!Object.hasOwn(SETTINGS, key)) {
    throw refused(`Unknown setting "${key}".`, { agent: `Known settings: ${Object.keys(SETTINGS).join(", ")}.` });
  }
}
