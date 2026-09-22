import { loadConfig } from "../lib/config.mjs";
import { ok, refused } from "../lib/output.mjs";
import { allSettings, getSetting, setSetting, unsetSetting } from "../lib/settings.mjs";

export const description = "Read or change this machine's personal toolkit preferences (never committed). Change them when the operator asks.";
export const usage = "settings [get <key> | set <key> <value> | unset <key>]";

export default async function run({ cwd, positional }) {
  loadConfig(cwd);
  const [action = "list", key, value] = positional;
  if (action === "list") {
    const settings = allSettings(cwd);
    return ok({
      operator: "",
      agent: Object.entries(settings).map(([name, entry]) => `${name} = ${JSON.stringify(entry.value)}${entry.local ? " (set on this machine)" : " (default)"}: ${entry.description}`).join("\n"),
      data: settings,
    });
  }
  if (action === "get") return ok({ operator: "", agent: JSON.stringify(getSetting(cwd, key)), data: { key, value: getSetting(cwd, key) } });
  if (action === "set") {
    const stored = setSetting(cwd, key, value);
    return ok({ operator: "Done, I changed that preference for this computer.", agent: `${key} = ${JSON.stringify(stored)} (local to this machine).`, data: { key, value: stored } });
  }
  if (action === "unset") {
    const fallback = unsetSetting(cwd, key);
    return ok({ operator: "Done, that preference is back to its default.", agent: `${key} reset to ${JSON.stringify(fallback)}.`, data: { key, value: fallback } });
  }
  throw refused(`Unknown settings action "${action}".`, { agent: `Usage: ${usage}` });
}
