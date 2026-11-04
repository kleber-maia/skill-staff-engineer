import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { rmSync } from "node:fs";

import { defaultConfig, mergeConfig, validateConfig } from "./config.mjs";
import { uncoveredSourceAreas } from "./test-coverage.mjs";
import { cleanup, commitAll, git, installInto, makeTempRepo, runCli, writeFiles } from "./test-helpers.mjs";

const source = "App/Category Views/Picker.swift";
const integration = "Tests/CatalogIntegrationTests.swift";
const association = {
  source: "App/Category Views/**",
  tests: [integration],
  reason: "Integration assertions exercise category selection identity and retained references.",
};
const fixture = {
  [source]: "struct Picker { let count = 1 }\n",
  "App/Model/Catalog.swift": "struct Catalog { let count = 1 }\n",
  "App/Auth/Session.swift": "struct Session { let count = 1 }\n",
  [integration]: "import XCTest\n@testable import Demo\nfinal class CatalogIntegrationTests: XCTestCase {\n  func testCatalogIdentity() { XCTAssertEqual(Picker().count, 2); XCTAssertEqual(Catalog().count, 2) }\n}\n",
  "README.md": "# Demo\n",
};

function changedFixture() {
  const cwd = makeTempRepo({ files: fixture });
  writeFiles(cwd, {
    [source]: "struct Picker { let count = 2 }\n",
    "App/Model/Catalog.swift": "struct Catalog { let count = 2 }\n",
    "App/Auth/Session.swift": "struct Session { let count = 2 }\n",
    [integration]: fixture[integration].replace("2)", "2, \"Retains selection identity\")"),
  });
  return cwd;
}

function configured() {
  const config = defaultConfig();
  config.paths.source = ["App/**"];
  config.paths.tests = ["Tests/**"];
  config.rules.testAssociations = [association, { ...association, source: "App/Model/**" }];
  return config;
}

test("shared Swift integration tests can relate to multiple source areas without covering unrelated work", () => {
  const cwd = changedFixture();
  try {
    git(cwd, "add", "-A");
    const files = [source, "App/Model/Catalog.swift", "App/Auth/Session.swift", integration];
    const config = configured();
    assert.deepEqual(uncoveredSourceAreas(cwd, config, files), ["App/Auth"]);
    config.rules.testAssociations = [];
    assert.deepEqual(uncoveredSourceAreas(cwd, config, files), ["App/Auth", "App/Category Views", "App/Model"]);
  } finally { cleanup(cwd); }
});

test("a configured relationship cannot count an unchanged or unstaged integration test", () => {
  const cwd = changedFixture();
  try {
    git(cwd, "add", source);
    // A modified test exists on disk and its old blob exists in the index, but it
    // is not a changed staged file in this batch.
    assert.deepEqual(uncoveredSourceAreas(cwd, configured(), [source]), ["App/Category Views"]);
    git(cwd, "add", integration);
    assert.deepEqual(uncoveredSourceAreas(cwd, configured(), [source, integration]), []);
  } finally { cleanup(cwd); }
});

test("deleted, unrelated and unrecognized test paths cannot satisfy a declaration", () => {
  const cwd = changedFixture();
  try {
    rmSync(join(cwd, integration));
    writeFiles(cwd, { "Tests/OtherTests.swift": fixture[integration], "notes.md": "Catalog coverage description.\n" });
    git(cwd, "add", "-A");
    const config = configured();
    assert.deepEqual(uncoveredSourceAreas(cwd, config, [source, integration, "Tests/OtherTests.swift"]), ["App/Category Views"]);
    config.rules.testAssociations = [{ ...association, tests: ["notes.md"] }];
    assert.deepEqual(uncoveredSourceAreas(cwd, config, [source, "notes.md"]), ["App/Category Views"]);
  } finally { cleanup(cwd); }
});

test("legacy configuration retains an empty association list and declarations are validated", () => {
  const legacy = mergeConfig(defaultConfig(), { version: 1, rules: { requireTestPerSourceChange: true } });
  assert.deepEqual(legacy.rules.testAssociations, []);
  assert.deepEqual(validateConfig(legacy), []);
  const config = configured();
  assert.deepEqual(validateConfig(config), []);
  for (const invalid of [null, {}, [null], [{ ...association, source: "../outside/**" }], [{ ...association, source: "/outside/**" }], [{ ...association, source: "!App/**" }], [{ ...association, tests: [] }], [{ ...association, tests: ["C:\\outside\\test.swift"] }], [{ ...association, tests: ["Tests/../outside.swift"] }], [{ ...association, reason: "" }], [{ ...association, exemption: true }]]) {
    config.rules.testAssociations = invalid;
    assert.ok(validateConfig(config).some((error) => error.includes("rules.testAssociations")), JSON.stringify(invalid));
  }
});

test("the supported config command fixes association while lifecycle still rejects removing the changed test", async () => {
  const cwd = makeTempRepo({ files: fixture });
  try {
    await installInto(cwd);
    await runCli(["config", "set", "paths.tests", JSON.stringify(["Tests/**"])], { cwd });
    commitAll(cwd, "Install toolkit");
    writeFiles(cwd, { [source]: "struct Picker { let count = 2 }\n", "App/Model/Catalog.swift": "struct Catalog { let count = 2 }\n", [integration]: fixture[integration].replace("2)", "2, \"Retains selection identity\")"), "README.md": "# Demo\nSelection identity is preserved.\n" });
    git(cwd, "add", source, "App/Model/Catalog.swift", integration, "README.md");
    let result = await runCli(["lifecycle", "--json"], { cwd });
    assert.ok(result.json.data.blocking.some((finding) => finding.rule === "test-coverage"));
    result = await runCli(["config", "set", "rules.testAssociations", JSON.stringify([association, { ...association, source: "App/Model/**" }]), "--json"], { cwd });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    git(cwd, "add", ".staff-engineer/config.json");
    result = await runCli(["lifecycle", "--json"], { cwd });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    git(cwd, "reset", "HEAD", "--", integration);
    result = await runCli(["lifecycle", "--json"], { cwd });
    assert.ok(result.json.data.blocking.some((finding) => finding.rule === "test-coverage"));
  } finally { cleanup(cwd); }
});
