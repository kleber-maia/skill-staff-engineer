import { test } from "node:test";
import assert from "node:assert/strict";

import { HASH, hasBlock, removeBlock, upsertBlock } from "./managed-block.mjs";

test("creates a block when the file does not exist", () => {
  const { text, action } = upsertBlock(null, "x", "hello");
  assert.equal(action, "created");
  assert.equal(text, "<!-- x:start -->\nhello\n<!-- x:end -->\n");
});

test("appends without touching existing text and replaces only inside markers", () => {
  const user = "# My project\n\nMy own notes.\n";
  const first = upsertBlock(user, "x", "v1");
  assert.equal(first.action, "appended");
  assert.ok(first.text.startsWith(user));
  const second = upsertBlock(first.text, "x", "v2");
  assert.equal(second.action, "replaced");
  assert.ok(second.text.startsWith(user));
  assert.ok(second.text.includes("v2"));
  assert.ok(!second.text.includes("v1"));
  const third = upsertBlock(second.text, "x", "v2");
  assert.equal(third.action, "unchanged");
  assert.equal(third.text, second.text);
});

test("hash style for .gitignore and removal restores the original", () => {
  const original = "node_modules/\n";
  const added = upsertBlock(original, "x", ".staff-engineer/backups/", HASH);
  assert.ok(added.text.includes("# x:start\n.staff-engineer/backups/\n# x:end"));
  assert.ok(hasBlock(added.text, "x", HASH));
  const removed = removeBlock(added.text, "x", HASH);
  assert.equal(removed.action, "removed");
  assert.equal(removed.text, original);
});

test("removing the only block yields an empty file", () => {
  const { text } = removeBlock(upsertBlock(null, "x", "only").text, "x");
  assert.equal(text, "");
});
