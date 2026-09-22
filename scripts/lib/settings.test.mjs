import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { cleanup, commitAll, git, installInto, makeTempRepo, runCli } from "./test-helpers.mjs";

test("settings are local to the machine, validated, and never show up as project changes", async () => {
  const dir = makeTempRepo({ files: { "README.md": "# demo\n" } });
  try {
    await installInto(dir);
    commitAll(dir, "install");
    let result = await runCli(["settings", "--json"], { cwd: dir });
    assert.equal(result.json.data["preview.selfCheck"].value, "auto");
    assert.equal(result.json.data["updates.checkEveryHours"].value, 24);

    result = await runCli(["settings", "set", "preview.selfCheck", "off", "--json"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal((await runCli(["settings", "get", "preview.selfCheck", "--json"], { cwd: dir })).json.data.value, "off");
    assert.ok(existsSync(join(dir, ".git", "staff-engineer", "settings.json")));
    assert.equal(git(dir, "status", "--short"), "", "nothing to commit");

    assert.equal((await runCli(["settings", "set", "preview.selfCheck", "sometimes", "--json"], { cwd: dir })).code, 1);
    assert.equal((await runCli(["settings", "set", "updates.checkEveryHours", "-1", "--json"], { cwd: dir })).code, 1);
    assert.equal((await runCli(["settings", "set", "gates.test", "x", "--json"], { cwd: dir })).code, 1, "only whitelisted preferences");

    result = await runCli(["settings", "unset", "preview.selfCheck", "--json"], { cwd: dir });
    assert.equal(result.json.data.value, "auto");
  } finally {
    cleanup(dir);
  }
});
