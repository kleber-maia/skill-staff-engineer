import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import ship from "../commands/ship.mjs";
import { defaultConfig } from "../lib/config.mjs";
import { output } from "../lib/exec.mjs";
import { head } from "../lib/git.mjs";
import { readSession, writeSession } from "../lib/session.mjs";
import { commitMatches, pendingCommitParents } from "../lib/shipping.mjs";
import { cleanup, makeTempRepo } from "../lib/test-helpers.mjs";

function fixture(t, initialCommit = true) {
  const config = defaultConfig();
  config.shipping.mode = "local";
  const cwd = makeTempRepo({ files: { ".staff-engineer/config.json": JSON.stringify(config), "base.txt": "base\n" }, commit: initialCommit });
  t.after(() => cleanup(cwd));
  const git = (...args) => output("git", args, { cwd });
  return { cwd, git };
}

function merging(t) {
  const f = fixture(t);
  f.git("checkout", "--quiet", "-b", "feature");
  writeFileSync(join(f.cwd, "feature.txt"), "feature\n");
  f.git("add", "feature.txt");
  f.git("commit", "--quiet", "-m", "Feature fixture");
  const feature = head(f.cwd);
  f.git("checkout", "--quiet", "main");
  writeFileSync(join(f.cwd, "main.txt"), "main\n");
  f.git("add", "main.txt");
  f.git("commit", "--quiet", "-m", "Main fixture");
  const baseCommit = head(f.cwd);
  f.git("merge", "--no-commit", "--no-ff", "feature");
  const journal = { baseCommit, expectedTree: f.git("write-tree"), expectedParents: pendingCommitParents(f.cwd, baseCommit), target: null, approval: { evidence: "agent-reported", quote: "Fixture approval" }, message: "Merge fixture feature", trailers: {} };
  assert.deepEqual(journal.expectedParents, [baseCommit, feature]);
  return { ...f, journal, feature };
}

function interrupted(f, status = "open") {
  writeSession(f.cwd, { version: 1, status, phase: "finalizing", concern: "Merge fixture", startedAt: new Date().toISOString(), baseCommit: f.journal.baseCommit, shipping: f.journal, ...(status === "saved" ? { savedCommit: head(f.cwd) } : {}) });
}

test("root and ordinary commits retain strict exact-tree and single-parent validation", (t) => {
  const { cwd, git } = fixture(t, false);
  assert.deepEqual(pendingCommitParents(cwd, null), []);
  git("add", "-A");
  const rootTree = git("write-tree");
  git("commit", "--quiet", "-m", "Root fixture");
  const root = head(cwd);
  assert.equal(commitMatches(cwd, root, { baseCommit: null, expectedTree: rootTree }), true);
  writeFileSync(join(cwd, "base.txt"), "next\n");
  git("add", "base.txt");
  assert.deepEqual(pendingCommitParents(cwd, root), [root]);
  const expectedTree = git("write-tree");
  git("commit", "--quiet", "-m", "Ordinary fixture");
  const revision = head(cwd);
  const journal = { baseCommit: root, expectedTree };
  assert.equal(commitMatches(cwd, revision, journal), true); // Legacy journal.
  assert.equal(commitMatches(cwd, revision, { ...journal, expectedParents: [root] }), true);
  assert.equal(commitMatches(cwd, revision, { ...journal, expectedTree: rootTree }), false);
  assert.equal(commitMatches(cwd, revision, { ...journal, expectedParents: [] }), false);
  assert.equal(commitMatches(cwd, revision, { ...journal, expectedParents: [revision] }), false);
});

test("merge journal validates every ordered parent after Git removes MERGE_HEAD", (t) => {
  const f = merging(t);
  f.git("commit", "--quiet", "-m", "Merge fixture");
  const revision = head(f.cwd);
  assert.equal(existsSync(join(f.cwd, ".git/MERGE_HEAD")), false);
  assert.equal(commitMatches(f.cwd, revision, f.journal), true);
  const { expectedParents, ...legacy } = f.journal;
  assert.equal(commitMatches(f.cwd, revision, legacy), false);
  for (const parents of [[expectedParents[0]], [...expectedParents].reverse(), [...expectedParents, revision]]) {
    assert.equal(commitMatches(f.cwd, revision, { ...f.journal, expectedParents: parents }), false);
  }
  const wrong = f.git("commit-tree", f.journal.expectedTree, "-p", f.journal.baseCommit, "-p", revision, "-m", "Wrong merge fixture");
  assert.equal(commitMatches(f.cwd, wrong, f.journal), false);
});

for (const status of ["open", "saved"]) {
  test(`interrupted ${status} merge save recovers the exact existing commit`, async (t) => {
    const f = merging(t);
    f.git("commit", "--quiet", "-m", "Merge fixture");
    const savedCommit = head(f.cwd);
    interrupted(f, status);
    const result = await ship({ cwd: f.cwd, positional: [], flags: { "sync-only": true } });
    assert.equal(result.data.commit, savedCommit);
    assert.equal(readSession(f.cwd).status, "synced");
    assert.equal(head(f.cwd), savedCommit);
    assert.equal(f.git("show", "-s", "--format=%P", savedCommit), f.journal.expectedParents.join(" "));
  });
}

test("interrupted merge recovery rejects an unexpected parent before marking saved", async (t) => {
  const f = merging(t);
  f.git("commit", "--quiet", "-m", "Merge fixture");
  f.journal.expectedParents = [f.journal.baseCommit];
  interrupted(f);
  await assert.rejects(ship({ cwd: f.cwd, positional: [], flags: { "sync-only": true } }), /checkout changed during an interrupted save/);
  assert.equal(readSession(f.cwd).status, "open");
});

test("pre-commit retry rejects changed merge parents without creating a commit", async (t) => {
  const f = merging(t);
  interrupted(f);
  f.git("merge", "--quit");
  await assert.rejects(ship({ cwd: f.cwd, positional: [], flags: {} }), /commit parents changed during an interrupted save/);
  assert.equal(head(f.cwd), f.journal.baseCommit);
});

test("pre-commit merge retry creates and delivers only the journaled ordered merge", async (t) => {
  const f = merging(t);
  interrupted(f);
  const result = await ship({ cwd: f.cwd, positional: [], flags: {} });
  assert.equal(result.data.commit, head(f.cwd));
  assert.equal(readSession(f.cwd).status, "synced");
  assert.equal(commitMatches(f.cwd, head(f.cwd), f.journal), true);
  assert.equal(f.git("show", "-s", "--format=%P", head(f.cwd)), f.journal.expectedParents.join(" "));
});
