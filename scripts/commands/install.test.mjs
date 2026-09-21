import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { listFiles } from "../lib/fs-safe.mjs";
import { cleanup, git, installInto, makeTempDir, makeTempRepo, runCli, writeFiles } from "../lib/test-helpers.mjs";
import { configFromDetection } from "./install.mjs";

const USER_AGENTS = "# My project\n\nMy own instructions stay here.\n";
const USER_IGNORE = "node_modules/\ndist/\n";

test("legacy detection results inherit documentable path defaults", () => {
  const config = configFromDetection({
    languages: ["javascript"],
    packageManager: "npm",
    gates: {},
    paths: { source: ["src/**"] },
  }, "legacy-version");
  assert.deepEqual(config.paths.source, ["src/**"]);
  assert.ok(config.paths.documentable.includes("scripts/**"));
});

test("install is idempotent and preserves user text outside managed blocks", async () => {
  const dir = makeTempRepo({ fixture: "node-npm", files: { "AGENTS.md": USER_AGENTS, ".gitignore": USER_IGNORE } });
  try {
    const first = await installInto(dir);
    assert.ok(first.data.changed.length > 5);
    const snapshot = snapshotFiles(dir);

    const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
    assert.ok(agents.startsWith(USER_AGENTS), "user text first");
    assert.ok(agents.includes("<!-- staff-engineer:start -->"));
    assert.ok(readFileSync(join(dir, ".gitignore"), "utf8").startsWith(USER_IGNORE));
    assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
    assert.ok(existsSync(join(dir, ".staff-engineer/cli.mjs")));
    assert.ok(existsSync(join(dir, ".agents/skills/staff-engineer/SKILL.md")));
    assert.ok(existsSync(join(dir, ".agents/skills/staff-engineer/.staff-engineer-owned")));
    assert.ok(!existsSync(join(dir, ".staff-engineer/lib/glob.test.mjs")), "tests are not vendored");

    const config = JSON.parse(readFileSync(join(dir, ".staff-engineer/config.json"), "utf8"));
    assert.equal(config.gates.test.cmd, "npm test");
    assert.equal(config.preview.kind, "web");

    const second = await installInto(dir);
    assert.deepEqual(second.data.changed, [], "second install changes nothing");
    assert.deepEqual(snapshotFiles(dir), snapshot, "files are byte-identical after a second install");
  } finally {
    cleanup(dir);
  }
});

test("dry run writes nothing", async () => {
  const dir = makeTempRepo({ fixture: "go-mod" });
  try {
    const before = listFiles(dir);
    const result = await runCli(["install", "--target", dir, "--dry-run", "--json"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(result.json.data.dryRun, true);
    assert.ok(result.json.data.actions.length > 5);
    assert.deepEqual(listFiles(dir), before);
  } finally {
    cleanup(dir);
  }
});

test("existing non-owned skills are a refusal until --replace-existing-skills, then backed up", async () => {
  const dir = makeTempRepo({ fixture: "empty", files: { ".agents/skills/grill-me/SKILL.md": "---\nname: grill-me\n---\nold version\n" } });
  try {
    let result = await runCli(["install", "--target", dir, "--yes", "--json"], { cwd: dir });
    assert.equal(result.code, 1);
    assert.deepEqual(result.json.data.collisions, ["grill-me"]);
    assert.ok(!existsSync(join(dir, ".staff-engineer/cli.mjs")), "nothing written on refusal");

    result = await runCli(["install", "--target", dir, "--yes", "--replace-existing-skills", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(existsSync(join(dir, ".agents/skills/grill-me/.staff-engineer-owned")));
    const backups = join(dir, ".staff-engineer/backups");
    const stamp = readdirSync(backups)[0];
    assert.equal(readFileSync(join(backups, stamp, ".agents/skills/grill-me/SKILL.md"), "utf8"), "---\nname: grill-me\n---\nold version\n");
  } finally {
    cleanup(dir);
  }
});

test("uninstall removes only toolkit-owned files and blocks", async () => {
  const dir = makeTempRepo({ fixture: "node-npm", files: { "AGENTS.md": USER_AGENTS, ".gitignore": USER_IGNORE, ".agents/skills/my-own/SKILL.md": "---\nname: my-own\n---\n" } });
  try {
    await installInto(dir);
    const result = await runCli(["install", "--target", dir, "--uninstall", "--json"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), USER_AGENTS);
    assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), USER_IGNORE);
    assert.ok(!existsSync(join(dir, ".staff-engineer")));
    assert.ok(!existsSync(join(dir, ".agents/skills/grill-me")));
    assert.ok(existsSync(join(dir, ".agents/skills/my-own/SKILL.md")), "foreign skills stay");
    assert.ok(!existsSync(join(dir, "CLAUDE.md")), "a CLAUDE.md the toolkit created is removed");
  } finally {
    cleanup(dir);
  }
});

test("non-repo needs --init-git; --with-claude-hooks merges settings", async () => {
  const dir = makeTempDir();
  writeFiles(dir, { "index.html": "<h1>hi</h1>", ".claude/settings.json": JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } }) });
  try {
    let result = await runCli(["install", "--target", dir, "--yes", "--json"], { cwd: dir });
    assert.equal(result.code, 2);
    result = await runCli(["install", "--target", dir, "--yes", "--init-git", "--with-claude-hooks", "--json"], { cwd: dir, env: { CLAUDE_PLUGIN_ROOT: "" } });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(git(dir, "rev-parse", "--is-inside-work-tree"), "true");
    const settings = JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"));
    assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
    assert.equal(settings.hooks.Stop.length, 2, "user hook kept, ours added");
    assert.ok(settings.hooks.PreToolUse.some((entry) => entry.matcher === "Bash"));
    const config = JSON.parse(readFileSync(join(dir, ".staff-engineer/config.json"), "utf8"));
    assert.equal(config.gates.test, null, "static site: tests not applicable");
  } finally {
    cleanup(dir);
  }
});

function snapshotFiles(dir) {
  const out = {};
  for (const file of listFiles(dir, { ignore: [".git", "node_modules", "backups"] })) {
    const path = join(dir, file);
    out[file] = statSync(path).isFile() ? readFileSync(path, "utf8") : "";
  }
  return out;
}

test("installed and upgraded lifecycle blocks weak test assertions from the staged index", async () => {
  const dir = makeTempRepo({ fixture: "node-npm" });
  try {
    await installInto(dir);
    git(dir, "add", ".");
    git(dir, "commit", "--quiet", "-m", "install");
    // Simulate an older installed module, then prove upgrade replaces it.
    writeFiles(dir, {
      ".staff-engineer/VERSION": "0.2.0\n",
      ".staff-engineer/lib/test-quality.mjs": "export const obsolete = true;\n",
    });
    await installInto(dir);
    writeFiles(dir, { "tests/theme.spec.ts": "await expect(page.locator('html')).toHaveClass(/dark|light/);\n" });
    git(dir, "add", "tests/theme.spec.ts");
    const { spawnSync } = await import("node:child_process");
    const blocked = spawnSync(process.execPath, [".staff-engineer/cli.mjs", "lifecycle", "--json"], { cwd: dir, encoding: "utf8" });
    assert.equal(blocked.status, 3, blocked.stdout + blocked.stderr);
    const report = JSON.parse(blocked.stdout || blocked.stderr);
    assert.ok(report.data.blocking.some(({ rule }) => rule === "test-theme-no-op"));
    writeFiles(dir, { "tests/theme.spec.ts": "await expect(page.locator('html')).toHaveClass(/dark/);\n" });
    git(dir, "add", "tests/theme.spec.ts");
    const passed = spawnSync(process.execPath, [".staff-engineer/cli.mjs", "lifecycle", "--json"], { cwd: dir, encoding: "utf8" });
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  } finally {
    cleanup(dir);
  }
});

test("installed lifecycle can enforce the whole-test quality baseline", async () => {
  const dir = makeTempRepo({ fixture: "node-npm" });
  try {
    writeFiles(dir, { "tests/legacy-theme.spec.ts": "await expect(page.locator('html')).toHaveClass(/dark|light/);\n" });
    git(dir, "add", ".");
    git(dir, "commit", "--quiet", "-m", "legacy test debt");
    await installInto(dir);
    await runCli(["config", "set", "rules.testQuality.scope", "all"], { cwd: dir });
    git(dir, "add", ".");
    git(dir, "commit", "--quiet", "-m", "install strict toolkit");

    writeFiles(dir, { "README.md": "# Updated docs\n" });
    git(dir, "add", "README.md");
    const { spawnSync } = await import("node:child_process");
    const blocked = spawnSync(process.execPath, [".staff-engineer/cli.mjs", "lifecycle", "--json"], { cwd: dir, encoding: "utf8" });
    assert.equal(blocked.status, 3, blocked.stdout + blocked.stderr);
    const report = JSON.parse(blocked.stdout || blocked.stderr);
    assert.ok(report.data.blocking.some(({ rule, file }) => rule === "test-theme-no-op" && file === "tests/legacy-theme.spec.ts"));
  } finally {
    cleanup(dir);
  }
});
