import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, githubRepository, latestRelease, stableVersion } from "./releases.mjs";

test("stable versions compare numerically and reject ambiguous or prerelease labels", () => {
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.8.0", "0.9.0"), -1);
  for (const version of ["01.2.3", "1.2", "v1.2.3", "1.2.3-beta.1", "1.2.3+build", "1.2.3\n"]) assert.equal(stableVersion(version), false);
});

test("release URLs accept GitHub clone forms and reject other hosts and paths", () => {
  for (const source of ["https://github.com/owner/repo.git", "https://github.com/owner/repo/", "git@github.com:owner/repo.git", "ssh://git@github.com/owner/repo.git"]) {
    assert.equal(githubRepository(source), "owner/repo");
  }
  for (const source of ["https://github.com.evil.test/owner/repo", "https://github.com/owner/repo/tree/main", "file:///tmp/repo"]) assert.equal(githubRepository(source), null);
});

test("release lookup uses the latest published stable release with a bounded request", async () => {
  const release = { tag_name: "v0.9.0", draft: false, prerelease: false, published_at: "2026-10-20T00:00:00Z" };
  const result = await latestRelease("git@github.com:owner/repo.git", {
    timeoutMs: 1000,
    fetcher: async (url, options) => {
      assert.equal(url, "https://api.github.com/repos/owner/repo/releases/latest");
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => release };
    },
  });
  assert.deepEqual(result, { tag: "v0.9.0", version: "0.9.0" });
  for (const invalid of [{ draft: true }, { prerelease: true }, { published_at: null }, { tag_name: "main" }, { tag_name: "0.9.0" }]) {
    await assert.rejects(latestRelease("https://github.com/owner/repo", { fetcher: async () => ({ ok: true, json: async () => ({ ...release, ...invalid }) }) }), /published, stable/);
  }
  assert.equal(await latestRelease("https://github.com/owner/repo", { fetcher: async () => ({ status: 404 }) }), null);
  await assert.rejects(latestRelease("https://github.com/owner/repo", { fetcher: async () => ({ status: 503, ok: false }) }), /503/);
  await assert.rejects(latestRelease("file:///tmp/repo"), /github.com/);
});
