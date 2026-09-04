// Locate toolkit assets whether running from the repo (scripts/lib) or from a
// vendored copy inside a project (.staff-engineer/lib).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const libDir = dirname(fileURLToPath(import.meta.url));

// Directory containing cli.mjs (either <repo>/scripts or <project>/.staff-engineer).
export function toolkitDir() {
  return resolve(libDir, "..");
}

// Directory containing rules/ and templates/ (repo root or the vendored dir).
export function assetsDir() {
  const dir = toolkitDir();
  return existsSync(join(dir, "rules")) ? dir : resolve(dir, "..");
}

export function assetPath(...segments) {
  return join(assetsDir(), ...segments);
}

export function toolkitVersion() {
  const versionFile = join(toolkitDir(), "VERSION");
  if (existsSync(versionFile)) return readFileSync(versionFile, "utf8").trim();
  const pkg = join(assetsDir(), "package.json");
  if (existsSync(pkg)) {
    try {
      return JSON.parse(readFileSync(pkg, "utf8")).version ?? "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
  return "0.0.0";
}

export function isVendored() {
  return existsSync(join(toolkitDir(), "VERSION"));
}
