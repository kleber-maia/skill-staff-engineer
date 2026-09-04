import { test } from "node:test";
import assert from "node:assert/strict";

import { concernCategories } from "./ship.mjs";

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
