import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { changedSymbols } from "../lib/review.mjs";
import { cleanup, commitAll, git, installInto, makeTempRepo, runCli, writeFiles } from "../lib/test-helpers.mjs";

const PROJECT = {
  "package.json": JSON.stringify({ name: "demo", private: true, type: "module" }),
  "src/cart/total.mjs": "export function cartTotal(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n",
  "src/cart/view.mjs": 'import { cartTotal } from "./total.mjs";\nexport const render = (items) => `Total: ${cartTotal(items)}`;\n',
  "src/billing/charge.mjs": "export const charge = (amount) => amount;\n",
  "tests/total.test.mjs": "",
  "README.md": "# Demo\n",
};

async function setup() {
  const dir = makeTempRepo({ files: PROJECT });
  await installInto(dir);
  for (const gate of ["install", "format", "lint", "typecheck", "test", "build", "e2e"]) await runCli(["config", "set", `gates.${gate}`, "null"], { cwd: dir });
  await runCli(["config", "set", "preview", '{"kind":"manual","instructions":"Open the cart"}'], { cwd: dir });
  commitAll(dir, "install");
  return dir;
}

async function accepted(dir, concern, files, lane = "standard") {
  await runCli(["begin", concern, "--lane", lane], { cwd: dir });
  await runCli(["brief", "--outcome", "The cart total handles discounts correctly.", "--accept", "Open the cart and see the discounted total"], { cwd: dir });
  await runCli(["context", ...Object.keys(files)], { cwd: dir });
  writeFiles(dir, files);
  await runCli(["preview"], { cwd: dir });
  await runCli(["finalize", "--approval-quote", "looks good"], { cwd: dir });
}

test("changed declarations are extracted across languages", () => {
  assert.deepEqual(changedSymbols("+export function cartTotal(a) {\n-def refund_order(x):\n+const applyDiscount = (x) => x\n context line function ignored() {}\n+++ b/file"), ["cartTotal", "refund_order", "applyDiscount"]);
});

test("the lane sets the level, risky paths raise it, and the local setting caps it", async () => {
  const dir = await setup();
  try {
    await accepted(dir, "Discounted cart totals", { "src/cart/total.mjs": "export function cartTotal(items, discount = 0) {\n  return items.reduce((sum, item) => sum + item.price, 0) - discount;\n}\n" });
    let result = await runCli(["review", "--json"], { cwd: dir });
    assert.equal(result.json.data.required.level, "standard");
    const packet = readFileSync(result.json.data.packet.path, "utf8");
    assert.match(packet, /Acceptance 1: Open the cart and see the discounted total/);
    assert.match(packet, /cartTotal: src\/cart\/view\.mjs:\d+/, "callers outside the change are listed");
    assert.match(packet, /- discount;/);
    assert.match(result.json.agent, /ONE fresh-context reviewer/);

    writeFiles(dir, { "src/billing/charge.mjs": "export const charge = (amount) => Math.max(0, amount);\n" });
    result = await runCli(["review", "--json"], { cwd: dir });
    assert.equal(result.json.data.required.level, "detailed", "money raises the level");
    assert.match(result.json.data.required.reasons.join(" "), /touches money/);

    await runCli(["settings", "set", "review.maxLevel", "minimum"], { cwd: dir });
    result = await runCli(["review", "--json"], { cwd: dir });
    assert.equal(result.json.data.required.level, "minimum");
    assert.equal(result.json.data.required.capped, true);
  } finally {
    cleanup(dir);
  }
});

test("reviews wait for acceptance outside the trivial lane, and documentation needs none", async () => {
  const dir = await setup();
  try {
    await runCli(["begin", "Discounted cart totals"], { cwd: dir });
    await runCli(["brief", "--outcome", "The cart total handles discounts correctly.", "--accept", "See the total"], { cwd: dir });
    appendFileSync(join(dir, "src/cart/total.mjs"), "export const zero = 0;\n");
    assert.equal((await runCli(["review", "--json"], { cwd: dir })).code, 1, "standard reviews happen once, after acceptance");
    await runCli(["abort", "--discard-confirmed"], { cwd: dir });
    git(dir, "checkout", "--", "src/cart/total.mjs");

    await runCli(["begin", "Explain the cart in docs", "--lane", "trivial"], { cwd: dir });
    await runCli(["brief", "--outcome", "The readme explains the cart total.", "--accept", "Read the readme"], { cwd: dir });
    appendFileSync(join(dir, "README.md"), "The cart sums prices.\n");
    const result = await runCli(["review", "--json"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(result.json.data.required.level, null);
  } finally {
    cleanup(dir);
  }
});

test("a lower level needs a written reason, which is saved with the change", async () => {
  const dir = await setup();
  try {
    await accepted(dir, "Clamp negative charges", { "src/billing/charge.mjs": "export const charge = (amount) => Math.max(0, amount);\n", "tests/total.test.mjs": "// covers charge clamping\n" });
    await runCli(["review"], { cwd: dir });
    let result = await runCli(["review", "done", "--level", "standard", "--found", "0", "--fixed", "0", "--json"], { cwd: dir });
    assert.equal(result.code, 1, "money needs detailed");
    result = await runCli(["review", "done", "--level", "standard", "--found", "2", "--fixed", "1", "--reported", "1", "--reason", "The only change is a one-line clamp already covered by an explicit test case.", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    appendFileSync(join(dir, "README.md"), "Charges never go negative.\n");
    git(dir, "add", "-A");
    await runCli(["verify", "--mode", "full"], { cwd: dir });
    await runCli(["handoff"], { cwd: dir });
    result = await runCli(["ship", "Clamp negative charges", "--approval-quote", "ship it", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const message = git(dir, "log", "-1", "--format=%B");
    assert.match(message, /Review: standard \(required detailed\), 2 found, 1 fixed, 1 reported/);
    assert.match(message, /Review-Downgrade: The only change is a one-line clamp/);
  } finally {
    cleanup(dir);
  }
});

test("code changed after a review needs a delta review before saving", async () => {
  const dir = await setup();
  try {
    await accepted(dir, "Discounted cart totals", { "src/cart/total.mjs": "export function cartTotal(items, discount = 0) {\n  return items.reduce((sum, item) => sum + item.price, 0) - discount;\n}\n", "tests/total.test.mjs": "// discount\n" });
    await runCli(["review"], { cwd: dir });
    await runCli(["review", "done", "--found", "1", "--fixed", "0", "--reported", "0"], { cwd: dir });

    const fixed = readFileSync(join(dir, "src/cart/total.mjs"), "utf8").replace("- discount;", "- Math.min(discount, 100);");
    writeFileSync(join(dir, "src/cart/total.mjs"), fixed);
    appendFileSync(join(dir, "README.md"), "Discounts are capped.\n");
    git(dir, "add", "-A");
    assert.equal((await runCli(["next", "--json"], { cwd: dir })).json.data.step, "review");

    await runCli(["verify", "--mode", "full"], { cwd: dir });
    await runCli(["handoff"], { cwd: dir });
    let result = await runCli(["ship", "Cap cart discounts", "--approval-quote", "ship it", "--json"], { cwd: dir });
    assert.equal(result.code, 1);
    assert.match(result.json.operator, /not been reviewed in its current form/);

    result = await runCli(["review", "--json"], { cwd: dir });
    assert.equal(result.json.data.packet.delta, true);
    const packet = readFileSync(result.json.data.packet.path, "utf8");
    assert.match(packet, /Scope: DELTA/);
    assert.match(packet, /\+.*Math\.min\(discount, 100\)/);
    assert.doesNotMatch(packet, /\+export function cartTotal/, "unchanged reviewed lines are not sent again");
    await runCli(["review", "done", "--found", "0", "--fixed", "0"], { cwd: dir });

    result = await runCli(["ship", "Cap cart discounts", "--approval-quote", "ship it", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
  } finally {
    cleanup(dir);
  }
});
