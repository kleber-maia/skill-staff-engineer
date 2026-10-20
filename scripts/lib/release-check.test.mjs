import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRelease } from "../check-release.mjs";
import { cleanup, commitAll, git, makeTempRepo, writeFiles } from "./test-helpers.mjs";

function releaseRepository() {
  const dir = makeTempRepo({ files: {
    "package.json": '{"version":"0.9.0"}\n',
    ".claude-plugin/plugin.json": '{"version":"0.9.0"}\n',
    "CHANGELOG.md": "# Changelog\n\n- **0.9.0** Released updates.\n",
  } });
  const commit = git(dir, "rev-parse", "HEAD");
  git(dir, "update-ref", "refs/remotes/origin/main", commit);
  return { dir, options: { tag: "v0.9.0", commit } };
}

test("release preflight binds notes and version to the exact clean pushed commit", () => {
  const { dir, options } = releaseRepository();
  try {
    assert.deepEqual(checkRelease(dir, options), { ...options, notes: "**0.9.0** Released updates." });
    assert.throws(() => checkRelease(dir, { ...options, tag: "v0.8.0" }), /tag must be v0.9.0/);
    assert.throws(() => checkRelease(dir, { ...options, commit: "main" }), /full SHA/);
    assert.throws(() => checkRelease(dir, { ...options, commit: "a".repeat(40) }), /full SHA/);
    writeFiles(dir, { "README.md": "pending\n" });
    assert.throws(() => checkRelease(dir, options), /must be clean/);
    const unpushed = commitAll(dir, "not pushed");
    assert.throws(() => checkRelease(dir, { ...options, commit: unpushed }), /merge-base/);
  } finally {
    cleanup(dir);
  }
});

test("release preflight requires a version newer than every existing stable release tag", () => {
  const { dir, options } = releaseRepository();
  try {
    git(dir, "tag", "v0.8.0");
    assert.equal(checkRelease(dir, options).tag, "v0.9.0");
    git(dir, "tag", "v0.9.0");
    assert.throws(() => checkRelease(dir, options), /newer than existing tag v0.9.0/);
    git(dir, "tag", "--delete", "v0.9.0");
    git(dir, "tag", "v0.10.0");
    assert.throws(() => checkRelease(dir, options), /newer than existing tag v0.10.0/);
  } finally {
    cleanup(dir);
  }
});

test("release preflight refuses mismatched manifests and missing release notes", () => {
  const { dir, options } = releaseRepository();
  try {
    writeFiles(dir, { ".claude-plugin/plugin.json": '{"version":"0.8.0"}\n' });
    assert.throws(() => checkRelease(dir, options), /same stable/);
    writeFiles(dir, { ".claude-plugin/plugin.json": '{"version":"0.9.0"}\n', "CHANGELOG.md": "# Changelog\n" });
    const commit = commitAll(dir, "missing notes");
    git(dir, "update-ref", "refs/remotes/origin/main", commit);
    assert.throws(() => checkRelease(dir, { ...options, commit }), /needs release notes/);
  } finally {
    cleanup(dir);
  }
});
