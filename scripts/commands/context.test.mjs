import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, commitAll, git, installInto, makeTempRepo, runCli, writeFiles } from "../lib/test-helpers.mjs";

async function setup() {
  const dir = makeTempRepo({
    files: {
      "package.json": JSON.stringify({ name: "demo", private: true, type: "module", scripts: { test: "node -e 0" } }),
      "src/billing/invoice.mjs": 'import { money } from "../shared/money.mjs";\nexport const invoice = money;\n',
      "src/shared/money.mjs": "export const money = 1;\n",
      "src/billing/Invoice.tsx": "export const Invoice = () => null;\n",
      "tests/invoice.test.mjs": 'import { invoice } from "../src/billing/invoice.mjs";\n',
      "docs/billing.md": "# Billing\n\nThe invoice module computes totals.\n",
      "README.md": "# demo\n",
    },
  });
  await installInto(dir);
  await runCli(["config", "set", "preview", '{"kind":"manual","instructions":"look"}'], { cwd: dir });
  commitAll(dir, "install");
  return dir;
}

test("context packet lists skills, docs, tests, and dependencies; stale skills block the gate", async () => {
  const dir = await setup();
  try {
    let result = await runCli(["context", "src/billing/invoice.mjs", "src/billing/Invoice.tsx", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    const packet = result.json.data;
    const skills = packet.skills.map((skill) => skill.name);
    assert.ok(skills.includes("staff-engineer") && skills.includes("solid") && skills.includes("simplify") && skills.includes("ui-quality"), skills.join());
    assert.ok(!skills.includes("data-safety"));
    assert.deepEqual(packet.docs, ["docs/billing.md"]);
    assert.deepEqual(packet.tests, ["tests/invoice.test.mjs"]);
    assert.deepEqual(packet.dependencies, ["src/shared/money.mjs"]);
    assert.ok(packet.skills.every((skill) => skill.path && skill.digest));

    await runCli(["begin", "Invoice totals"], { cwd: dir });
    await runCli(["brief", "--outcome", "Invoices show a correct total.", "--accept", "Open an invoice and see the total"], { cwd: dir });
    appendFileSync(join(dir, "src/billing/invoice.mjs"), "export const total = 2;\n");
    writeFiles(dir, { "src/other/thing.mjs": "export const thing = 1;\n" });
    await runCli(["preview"], { cwd: dir });
    await runCli(["finalize"], { cwd: dir, env: { STAFF_ENGINEER_PREVIEW_APPROVED: "1" } });
    appendFileSync(join(dir, "tests/invoice.test.mjs"), "\n");
    appendFileSync(join(dir, "docs/billing.md"), "Totals.\n");
    git(dir, "add", "-A");

    result = await runCli(["lifecycle", "--json"], { cwd: dir });
    assert.equal(result.code, 0, JSON.stringify(result.json?.errors));
    assert.ok(result.json.data.warnings.some((finding) => finding.rule === "scope-grew"), "file outside the packet warns");

    appendFileSync(join(dir, ".agents/skills/solid/SKILL.md"), "\nA new rule.\n");
    result = await runCli(["lifecycle", "--json"], { cwd: dir });
    assert.equal(result.code, 3);
    assert.ok(result.json.data.blocking.some((finding) => finding.rule === "stale-skill"));
  } finally {
    cleanup(dir);
  }
});

test("update reinstalls from a local toolkit path", async () => {
  const dir = await setup();
  try {
    const result = await runCli(["update", "--json"], { cwd: dir });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.json.operator, /already up to date|Updated/);
    const dry = await runCli(["update", "--dry-run", "--json"], { cwd: dir });
    assert.equal(dry.code, 0);
  } finally {
    cleanup(dir);
  }
});
