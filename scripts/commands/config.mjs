import { coerceValue, CONFIG_FILE, defaultConfig, getPath, loadConfig, mergeConfig, saveConfig, setPath, unsetPath, validateConfig } from "../lib/config.mjs";
import { readJson } from "../lib/fs-safe.mjs";
import { configPath } from "../lib/config.mjs";
import { ok, refused, tooling } from "../lib/output.mjs";

export const description = "Read or change the project configuration.";
export const usage = "config get|set|unset <dotpath> [value]";

export default async function run({ cwd, positional }) {
  const [action, dotpath, ...rest] = positional;
  if (!action || (action !== "get" && !dotpath)) throw refused(`Usage: ${usage}`);
  if (action === "get") {
    const config = loadConfig(cwd);
    const value = dotpath ? getPath(config, dotpath) : config;
    return ok({ operator: dotpath ? `${dotpath} = ${JSON.stringify(value)}` : JSON.stringify(config, null, 2), data: { path: dotpath ?? "", value } });
  }
  const raw = readJson(configPath(cwd));
  if (!raw) throw tooling(`No ${CONFIG_FILE} found. Run install first.`);
  if (action === "set") {
    if (!rest.length) throw refused(`Usage: config set <dotpath> <value>. Use null for "not applicable".`);
    setPath(raw, dotpath, coerceValue(rest.join(" ")));
  } else if (action === "unset") {
    unsetPath(raw, dotpath);
  } else {
    throw refused(`Unknown config action "${action}". Use get, set, or unset.`);
  }
  const errors = validateConfig(mergeConfig(defaultConfig(), raw));
  if (errors.length) throw refused(`That change would make the configuration invalid: ${errors.join("; ")}`, { errors });
  saveConfig(cwd, raw);
  return ok({ operator: `Updated ${dotpath}.`, agent: `${dotpath} is now ${JSON.stringify(getPath(raw, dotpath))}.`, data: { path: dotpath, value: getPath(raw, dotpath) } });
}
