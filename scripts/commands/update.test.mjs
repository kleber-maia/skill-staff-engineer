import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { readJson } from "../lib/fs-safe.mjs";
import { cleanup, commitAll, git, installInto, makeTempDir, makeTempRepo, REPO_ROOT, runCli, writeFiles } from "../lib/test-helpers.mjs";

function sessionPath(dir) {
  return join(dir, ".git", "staff-engineer", "session.json");
}

async function installedProject() {
  const dir = makeTempRepo({ files: { "README.md": "# demo\n" } });
  await installInto(dir);
  commitAll(dir, "install toolkit");
  return dir;
}

function toolkitRepository(version) {
  const parent = makeTempDir("staff-engineer-source-");
  const dir = join(parent, "toolkit");
  cpSync(REPO_ROOT, dir, {
    recursive: true,
    filter(source) {
      const rel = relative(REPO_ROOT, source);
      return ![".git", "node_modules"].includes(rel.split(/[\\/]/)[0]);
    },
  });
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8"));
  writeFiles(dir, {
    "package.json": `${JSON.stringify({ ...pkg, version }, null, 2)}\n`,
    ".claude-plugin/plugin.json": `${JSON.stringify({ ...plugin, version }, null, 2)}\n`,
  });
  git(dir, "init", "--quiet", "--initial-branch=main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  commitAll(dir, `toolkit ${version}`);
  return { parent, dir };
}

test("begin checks for updates before it creates the session, then current versions start normally", async () => {
  const dir = await installedProject();
  let checked = false;
  try {
    let result = await runCli(["begin", "Ordered start", "--json"], {
      cwd: dir,
      services: {
        updateToolkit: async () => {
          assert.equal(existsSync(sessionPath(dir)), false, "the updater runs before session creation");
          checked = true;
          return { data: { updated: false } };
        },
      },
    });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(checked, true);
    assert.equal(existsSync(sessionPath(dir)), true);

    result = await runCli(["abort", "--json"], { cwd: dir });
    assert.equal(result.code, 0);
    result = await runCli(["begin", "Current toolkit starts", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.data.concern, "Current toolkit starts");
  } finally {
    cleanup(dir);
  }
});

test("a newer recorded repository updates first, opens no session, and requires a fresh begin", async () => {
  const dir = await installedProject();
  const stale = toolkitRepository("0.1.0");
  const latest = toolkitRepository("9.9.9");
  try {
    const manifestPath = join(dir, ".staff-engineer", "install.json");
    const manifest = readJson(manifestPath);
    writeFiles(dir, {
      ".staff-engineer/install.json": `${JSON.stringify({ ...manifest, source: { dir: stale.dir, url: pathToFileURL(latest.dir).href } }, null, 2)}\n`,
    });

    let result = await runCli(["begin", "Use fresh workflow", "--json"], { cwd: dir, services: {} });
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.match(result.json.operator, /updated to version 9\.9\.9/i);
    assert.equal(result.json.data.sessionOpened, false);
    assert.equal(result.json.data.restartRequired, true);
    assert.equal(existsSync(sessionPath(dir)), false);
    assert.equal(readFileSync(join(dir, ".staff-engineer", "VERSION"), "utf8").trim(), "9.9.9");
    assert.equal(readJson(manifestPath).source.url, pathToFileURL(latest.dir).href, "recorded URL wins over the stale local directory");

    const restarted = spawnSync(process.execPath, [join(dir, ".staff-engineer", "cli.mjs"), "begin", "Use fresh workflow", "--json"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(restarted.status, 0, restarted.stderr || restarted.stdout);
    assert.equal(JSON.parse(restarted.stdout).data.concern, "Use fresh workflow");
  } finally {
    cleanup(dir);
    cleanup(stale.parent);
    cleanup(latest.parent);
  }
});

test("an upstream lookup failure fails closed and leaves no session", async () => {
  const dir = await installedProject();
  try {
    const manifestPath = join(dir, ".staff-engineer", "install.json");
    const manifest = readJson(manifestPath);
    writeFiles(dir, {
      ".staff-engineer/install.json": `${JSON.stringify({ ...manifest, source: { dir: REPO_ROOT, url: pathToFileURL(join(dir, "missing-upstream.git")).href } }, null, 2)}\n`,
    });
    const before = readFileSync(join(dir, ".staff-engineer", "VERSION"), "utf8");
    const result = await runCli(["begin", "Cannot start offline", "--json"], { cwd: dir, services: {} });
    assert.equal(result.code, 2);
    assert.match(result.json.operator, /could not check its upstream repository/i);
    assert.equal(result.json.data.sessionOpened, false);
    assert.equal(existsSync(sessionPath(dir)), false);
    assert.equal(readFileSync(join(dir, ".staff-engineer", "VERSION"), "utf8"), before);
  } finally {
    cleanup(dir);
  }
});

test("explicit update --from a local path still works and is idempotent", async () => {
  const dir = await installedProject();
  const latest = toolkitRepository("8.8.8");
  try {
    let result = await runCli(["update", "--from", latest.dir, "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.data.updated, true);
    assert.equal(readFileSync(join(dir, ".staff-engineer", "VERSION"), "utf8").trim(), "8.8.8");

    result = await runCli(["update", "--from", latest.dir, "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.data.updated, false);
  } finally {
    cleanup(dir);
    cleanup(latest.parent);
  }
});

test("update checks do not run during an open concern or later lifecycle commands", async () => {
  const dir = await installedProject();
  let checks = 0;
  const services = {
    updateToolkit: async () => {
      checks += 1;
      return { data: { updated: false } };
    },
  };
  try {
    let result = await runCli(["begin", "One check only", "--json"], { cwd: dir, services });
    assert.equal(result.code, 0);
    result = await runCli(["brief", "--outcome", "Keep checks at the start.", "--accept", "Observe one lookup", "--json"], { cwd: dir, services });
    assert.equal(result.code, 0);
    result = await runCli(["status", "--json"], { cwd: dir, services });
    assert.equal(result.code, 0);
    result = await runCli(["begin", "Do not update mid-concern", "--json"], { cwd: dir, services });
    assert.equal(result.code, 1);
    assert.equal(checks, 1, "a second begin during active work refuses before checking upstream");
  } finally {
    cleanup(dir);
  }
});

test("a pinned revision is installed reproducibly and its resolved commit is recorded", async () => {
  const dir = await installedProject();
  const source = toolkitRepository("7.7.1");
  try {
    const pinned = git(source.dir, "rev-parse", "HEAD");
    const pkg = JSON.parse(readFileSync(join(source.dir, "package.json"), "utf8"));
    const plugin = JSON.parse(readFileSync(join(source.dir, ".claude-plugin", "plugin.json"), "utf8"));
    writeFiles(source.dir, {
      "package.json": `${JSON.stringify({ ...pkg, version: "7.7.2" }, null, 2)}\n`,
      ".claude-plugin/plugin.json": `${JSON.stringify({ ...plugin, version: "7.7.2" }, null, 2)}\n`,
    });
    commitAll(source.dir, "toolkit 7.7.2");

    const manifestPath = join(dir, ".staff-engineer", "install.json");
    const manifest = readJson(manifestPath);
    const configPath = join(dir, ".staff-engineer", "config.json");
    const config = readJson(configPath);
    config.updates.revision = pinned;
    writeFiles(dir, {
      ".staff-engineer/install.json": `${JSON.stringify({ ...manifest, source: { dir: null, url: pathToFileURL(source.dir).href, commit: manifest.source.commit } }, null, 2)}\n`,
      ".staff-engineer/config.json": `${JSON.stringify(config, null, 2)}\n`,
    });

    let result = await runCli(["begin", "Use pinned toolkit", "--json"], { cwd: dir, services: {} });
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.equal(readFileSync(join(dir, ".staff-engineer", "VERSION"), "utf8").trim(), "7.7.1");
    assert.equal(readJson(manifestPath).source.commit, pinned);
    assert.equal(readJson(configPath).updates.revision, pinned, "the pin survives installation");

    result = await runCli(["begin", "Use pinned toolkit", "--json"], { cwd: dir, services: {} });
    assert.equal(result.code, 0, result.stderr || result.stdout);
  } finally {
    cleanup(dir);
    cleanup(source.parent);
  }
});

test("offline allow policy opens work with the installed toolkit", async () => {
  const dir = await installedProject();
  try {
    const manifestPath = join(dir, ".staff-engineer", "install.json");
    const manifest = readJson(manifestPath);
    const configPath = join(dir, ".staff-engineer", "config.json");
    const config = readJson(configPath);
    config.updates.offline = "allow";
    writeFiles(dir, {
      ".staff-engineer/install.json": `${JSON.stringify({ ...manifest, source: { dir: null, url: pathToFileURL(join(dir, "missing-upstream.git")).href } }, null, 2)}\n`,
      ".staff-engineer/config.json": `${JSON.stringify(config, null, 2)}\n`,
    });
    const result = await runCli(["begin", "Work intentionally offline", "--json"], { cwd: dir, services: {} });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.data.concern, "Work intentionally offline");
  } finally {
    cleanup(dir);
  }
});

test("failed and timed-out installers restore toolkit-owned destinations", async () => {
  const dir = await installedProject();
  const broken = toolkitRepository("9.8.7");
  const hanging = makeTempDir("staff-engineer-hanging-");
  try {
    const versionPath = join(dir, ".staff-engineer", "VERSION");
    const agentsPath = join(dir, "AGENTS.md");
    const before = { version: readFileSync(versionPath, "utf8"), agents: readFileSync(agentsPath, "utf8") };
    rmSync(join(broken.dir, "rules"), { recursive: true, force: true });
    let result = await runCli(["update", "--from", broken.dir, "--json"], { cwd: dir });
    assert.equal(result.code, 2, result.stderr || result.stdout);
    assert.equal(readFileSync(versionPath, "utf8"), before.version);
    assert.equal(readFileSync(agentsPath, "utf8"), before.agents);

    writeFiles(hanging, { "scripts/cli.mjs": [
      "import { writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "const args = process.argv.slice(2);",
      "const target = args[args.indexOf('--target') + 1];",
      "writeFileSync(join(target, '.staff-engineer', 'VERSION'), 'partial-timeout\\n');",
      "setTimeout(() => {}, 10000);",
    ].join("\n") });
    const configPath = join(dir, ".staff-engineer", "config.json");
    const config = readJson(configPath);
    config.updates.timeoutMs = 1000;
    writeFiles(dir, { ".staff-engineer/config.json": `${JSON.stringify(config, null, 2)}\n` });
    const expectedConfig = readFileSync(configPath, "utf8");
    result = await runCli(["update", "--from", hanging, "--json"], { cwd: dir });
    assert.equal(result.code, 2, result.stderr || result.stdout);
    assert.equal(readFileSync(versionPath, "utf8"), before.version);
    assert.equal(readFileSync(configPath, "utf8"), expectedConfig);
  } finally {
    cleanup(dir);
    cleanup(broken.parent);
    cleanup(hanging);
  }
});
