import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseFollowup } from "./release-followup.mjs";

test("release prompts are completion-only and idempotent without reopening the task", () => {
  for (const status of ["open", "saved", "delivered"]) {
    const session = { status, savedCommit: "abc" };
    assert.equal(releaseFollowup(session).offer, null);
    assert.equal(session.releaseOffer, undefined);
  }
  const completed = { status: "synced", savedCommit: "abc", delivery: "remote" };
  const first = releaseFollowup(completed);
  assert.equal(first.session.status, "synced");
  assert.equal(first.offer.commit, "abc");
  assert.equal(first.session.releaseOffer, first.offer);
  const repeated = releaseFollowup(first.session);
  assert.equal(repeated.offer, null, "retrying completion must not prompt again");
  assert.deepEqual(repeated.session, first.session);
});
