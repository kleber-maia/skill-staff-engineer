// Optional preview screenshots through the project's own Playwright install.
// Never a hard dependency: when Playwright is absent the preview proceeds without them.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { ensureDir } from "./fs-safe.mjs";

export const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];

export function playwrightAvailable(root) {
  const pkg = join(root, "package.json");
  if (!existsSync(pkg)) return null;
  const require = createRequire(pkg);
  for (const name of ["playwright", "@playwright/test", "playwright-core"]) {
    try {
      return { name, path: require.resolve(name) };
    } catch {
      // try the next one
    }
  }
  return null;
}

export function shouldCapture(config) {
  const setting = config.preview?.screenshots ?? "auto";
  return setting === true || setting === "auto";
}

export function captureScreenshots(root, { url, paths = ["/"], outDir, timeoutMs = 120_000 }) {
  const playwright = playwrightAvailable(root);
  if (!playwright) return { ok: false, skipped: true, reason: "Playwright is not installed in this project.", files: [] };
  ensureDir(outDir);
  const runner = join(outDir, "capture.mjs");
  writeFileSync(runner, runnerSource(playwright.name), "utf8");
  const targets = paths.map((path) => ({ path, url: new URL(path, url).toString() }));
  const result = spawnSync(process.execPath, [runner, JSON.stringify({ targets, outDir, viewports: VIEWPORTS })], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  });
  const files = existsSync(outDir) ? readdirSync(outDir).filter((name) => name.endsWith(".png")).map((name) => join(outDir, name)).sort() : [];
  if (result.status !== 0) {
    return { ok: false, skipped: false, reason: (result.stderr || result.stdout || result.error?.message || "screenshot capture failed").trim().split(/\r?\n/).slice(-5).join("\n"), files };
  }
  return { ok: true, skipped: false, files };
}

function runnerSource(moduleName) {
  return `import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(join(process.cwd(), "package.json"));
const { chromium } = require(${JSON.stringify(moduleName)});
const { targets, outDir, viewports } = JSON.parse(process.argv[2]);
const browser = await chromium.launch();
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: Boolean(viewport.isMobile), deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const target of targets) {
      await page.goto(target.url, { waitUntil: "networkidle", timeout: 30000 });
      const slug = target.path.replace(/^\\//, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";
      await page.screenshot({ path: join(outDir, slug + "--" + viewport.name + ".png"), fullPage: false });
    }
    await context.close();
  }
} finally {
  await browser.close();
}
`;
}
