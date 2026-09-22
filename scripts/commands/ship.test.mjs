import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { concernCategories } from "./ship.mjs";
import { cleanup, commitAll, git, installInto, makeTempDir, makeTempRepo, runCli, writeFiles } from "../lib/test-helpers.mjs";

test("docs, tests, and config never count; other files count by top-level area", () => {
  const categories = concernCategories([
    "README.md",
    "docs/guide.md",
    "tests/a.test.ts",
    "src/features/billing/invoice.ts",
    "src/features/billing/total.ts",
    "package.json",
    ".github/workflows/ci.yml",
    "Makefile",
  ]);
  assert.deepEqual(categories, ["(root)", "src/features"]);
});

test("a typical single-feature batch stays within two categories", () => {
  const categories = concernCategories(["src/features/billing/invoice.ts", "src/features/billing/invoice.test.ts", "README.md"]);
  assert.deepEqual(categories, ["src/features"]);
  assert.deepEqual(concernCategories(["src/billing/invoice.ts", "src/billing/invoice.test.ts", "docs/billing.md"]), ["src/billing"]);
  assert.deepEqual(concernCategories(["src/billing/a.ts", "src/auth/b.ts", "lib/shared/c.ts"]), ["lib/shared", "src/auth", "src/billing"]);
});

test("failed push leaves a saved session that sync-only can recover", async () => {
  const dir = makeTempRepo({ files: { "README.md": "# demo\n" } });
  const remote = makeTempDir("staff-engineer-remote-");
  try {
    await installInto(dir);
    const configPath = join(dir, ".staff-engineer", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.gates = { install: null, format: null, lint: null, typecheck: null, test: null, build: null, e2e: null };
    writeFiles(dir, { ".staff-engineer/config.json": `${JSON.stringify(config, null, 2)}\n` });
    commitAll(dir, "install toolkit");
    git(dir, "remote", "add", "origin", join(dir, "missing-remote.git"));
    await runCli(["begin", "Improve sync recovery"], { cwd: dir });
    await runCli(["brief", "--outcome", "The readme includes a recovery note.", "--accept", "Read the recovery note"], { cwd: dir });
    writeFiles(dir, { "README.md": "# demo\n\nRecovery note.\n" });
    await runCli(["preview"], { cwd: dir });
    await runCli(["finalize", "--approval-quote", "looks good"], { cwd: dir });
    git(dir, "add", "README.md");
    await runCli(["verify", "--mode", "full"], { cwd: dir });
    await runCli(["handoff"], { cwd: dir });

    let result = await runCli(["ship", "Document sync recovery", "--approval-quote", "ship it", "--push", "--json"], { cwd: dir });
    assert.equal(result.code, 2, result.stderr || result.stdout);
    const session = JSON.parse(readFileSync(join(dir, ".git", "staff-engineer", "session.json"), "utf8"));
    assert.equal(session.status, "saved");
    assert.equal(session.savedCommit, git(dir, "rev-parse", "HEAD"));

    git(remote, "init", "--bare", "--quiet");
    git(dir, "remote", "set-url", "origin", remote);
    result = await runCli(["ship", "--sync-only", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.data.status, "synced");
  } finally {
    cleanup(dir);
    cleanup(remote);
  }
});
