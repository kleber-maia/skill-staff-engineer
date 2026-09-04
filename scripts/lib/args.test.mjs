import { test } from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "./args.mjs";

test("positional, single flags, equals form, booleans", () => {
  const { flags, positional } = parseArgs(["begin", "Add", "thing", "--mode", "fast", "--json", "--target=/tmp/x"], { booleans: ["json"] });
  assert.deepEqual(positional, ["begin", "Add", "thing"]);
  assert.equal(flags.mode, "fast");
  assert.equal(flags.json, true);
  assert.equal(flags.target, "/tmp/x");
});

test("repeated flags collect when declared multi", () => {
  const { flags } = parseArgs(["--accept", "a", "--accept", "b", "--outcome", "o"], { multi: ["accept"] });
  assert.deepEqual(flags.accept, ["a", "b"]);
  assert.equal(flags.outcome, "o");
});

test("a boolean flag does not swallow the next positional", () => {
  const { flags, positional } = parseArgs(["--yes", "value"], { booleans: ["yes"] });
  assert.equal(flags.yes, true);
  assert.deepEqual(positional, ["value"]);
});

test("double dash ends flag parsing", () => {
  const { flags, positional } = parseArgs(["--a", "1", "--", "--not-a-flag"]);
  assert.equal(flags.a, "1");
  assert.deepEqual(positional, ["--not-a-flag"]);
});
