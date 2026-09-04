import { test } from "node:test";
import assert from "node:assert/strict";

import { matches, matchesAny } from "./glob.mjs";

test("** matches nested paths and a bare name matches at any depth", () => {
  assert.ok(matches("src/a/b/c.ts", "src/**"));
  assert.ok(matches("src/c.ts", "src/**"));
  assert.ok(matches("deep/dir/app.log", "*.log"));
  assert.ok(matches("README.md", "README.md"));
  assert.ok(!matches("docs/README.md", "README.md") === false, "bare names match at any depth");
});

test("braces, single star, and question mark", () => {
  assert.ok(matches("src/x.tsx", "src/**/*.{ts,tsx}"));
  assert.ok(!matches("src/x.js", "src/**/*.{ts,tsx}"));
  assert.ok(matches("a/b.test.ts", "**/*.test.*"));
  assert.ok(matches("a/b1.ts", "a/b?.ts"));
  assert.ok(!matches("a/b12.ts", "a/b?.ts"));
});

test("env files and dotfiles", () => {
  assert.ok(matchesAny(".env", [".env", ".env.*"]));
  assert.ok(matchesAny(".env.local", [".env", ".env.*"]));
  assert.ok(matchesAny("apps/web/.env.production", [".env", ".env.*"]));
  assert.ok(!matchesAny("src/env.ts", [".env", ".env.*"]));
});

test("negation inside a list removes earlier matches", () => {
  assert.ok(matchesAny("src/a.go", ["**/*.go", "!**/*_test.go"]));
  assert.ok(!matchesAny("src/a_test.go", ["**/*.go", "!**/*_test.go"]));
});

test("windows separators are normalized", () => {
  assert.ok(matches("src\\lib\\x.ts", "src/**"));
});
