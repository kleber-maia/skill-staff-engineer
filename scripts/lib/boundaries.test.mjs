import { test } from "node:test";
import assert from "node:assert/strict";

import { areaOf, checkBoundaries } from "./boundaries.mjs";
import { defaultConfig } from "./config.mjs";
import { extractImports, importsOfFile, resolveImportTarget } from "./imports.mjs";
import { cleanup, makeTempRepo } from "./test-helpers.mjs";

const RULES = [
  { id: "no-cross-feature", files: ["src/features/*/**"], forbid: ["src/features/*/**"], allow: ["src/features/*/index.*"], sameArea: true, message: "Import another feature only through its public entrypoint." },
  { id: "components-no-features", files: ["src/components/**"], forbid: ["src/features/**"], message: "Components must not import features." },
];

function repo() {
  return makeTempRepo({
    files: {
      "package.json": "{}",
      "src/features/billing/invoice.ts": "export const invoice = 1;\n",
      "src/features/billing/total.ts": "export const total = 1;\n",
      "src/features/auth/index.ts": "export const auth = 1;\n",
      "src/features/auth/session.ts": "export const session = 1;\n",
      "src/components/Button.tsx": "export const Button = 1;\n",
      "app/__init__.py": "",
      "app/billing/__init__.py": "",
      "app/billing/service.py": "",
      "app/auth/__init__.py": "",
      "app/auth/models.py": "",
      "go.mod": "module example.com/app\n\ngo 1.22\n",
      "src/store.rs": "pub struct Db;\n",
    },
  });
}

test("import extraction across languages", () => {
  const js = extractImports("src/a.ts", [
    { line: 1, text: 'import { x } from "./x";' },
    { line: 2, text: "const y = require('../y');" },
    { line: 3, text: 'export * from "@/lib/z";' },
    { line: 4, text: 'import "reflect-metadata";' },
  ]).map((entry) => entry.specifier);
  assert.deepEqual(js, ["./x", "../y", "@/lib/z", "reflect-metadata"]);
  assert.deepEqual(extractImports("app/a.py", [{ line: 1, text: "from .models import User" }, { line: 2, text: "import app.billing.service as svc" }]).map((entry) => entry.specifier), [".models", "app.billing.service"]);
  assert.deepEqual(extractImports("main.go", [{ line: 1, text: '\t"example.com/app/internal/store"' }, { line: 2, text: 'import "fmt"' }]).map((entry) => entry.specifier), ["example.com/app/internal/store", "fmt"]);
  assert.deepEqual(extractImports("src/main.rs", [{ line: 1, text: "use crate::store::Db;" }]).map((entry) => entry.specifier), ["crate::store::Db"]);
});

test("relative, aliased, python, and go module targets resolve to repo paths", () => {
  const dir = repo();
  try {
    assert.equal(resolveImportTarget(dir, "src/features/billing/invoice.ts", "./total", "typescript"), "src/features/billing/total.ts");
    assert.equal(resolveImportTarget(dir, "src/features/billing/invoice.ts", "../auth", "typescript"), "src/features/auth/index.ts");
    assert.equal(resolveImportTarget(dir, "src/components/Button.tsx", "@/features/auth/session", "typescript", { aliases: { "@/": "src/" } }), "src/features/auth/session.ts");
    assert.equal(resolveImportTarget(dir, "src/a.ts", "react", "typescript"), null);
    assert.equal(resolveImportTarget(dir, "app/billing/service.py", "..auth.models", "python"), "app/auth/models.py");
    assert.equal(resolveImportTarget(dir, "app/billing/service.py", "app.auth", "python"), "app/auth/__init__.py");
    assert.equal(resolveImportTarget(dir, "app/billing/service.py", "os.path", "python"), null);
    assert.equal(resolveImportTarget(dir, "cmd/main.go", "example.com/app/internal/store", "go"), "internal/store");
    assert.equal(resolveImportTarget(dir, "cmd/main.go", "fmt", "go"), null);
    assert.equal(resolveImportTarget(dir, "src/main.rs", "crate::store::Db", "rust"), "src/store.rs");
  } finally {
    cleanup(dir);
  }
});

test("boundary rules flag cross-feature and component imports, allow entrypoints and same area", () => {
  const dir = repo();
  try {
    const config = defaultConfig();
    config.paths.source = ["src/**"];
    config.rules.boundaries = RULES;
    const diff = [
      { file: "src/features/billing/invoice.ts", status: "M", added: [
        { line: 1, text: 'import { total } from "./total";' },
        { line: 2, text: 'import { auth } from "../auth";' },
        { line: 3, text: 'import { session } from "../auth/session";' },
      ] },
      { file: "src/components/Button.tsx", status: "M", added: [{ line: 1, text: 'import { invoice } from "@/features/billing/invoice";' }] },
    ];
    const findings = checkBoundaries(dir, config, diff);
    assert.deepEqual(findings.map((finding) => [finding.rule, finding.file, finding.line]), [
      ["no-cross-feature", "src/features/billing/invoice.ts", 3],
      ["components-no-features", "src/components/Button.tsx", 1],
    ]);
    const excepted = checkBoundaries(dir, config, diff, { exceptions: [{ rule: "components-no-features", path: "src/components/**", reason: "Legacy coupling, removal planned in the next concern" }] });
    assert.equal(excepted.length, 1);
    assert.deepEqual(importsOfFile(dir, "src/features/billing/invoice.ts"), []);
  } finally {
    cleanup(dir);
  }
});

test("area is the path up to the first wildcard of the files glob", () => {
  assert.equal(areaOf("src/features/billing/invoice.ts", ["src/features/*/**"]), "src/features/billing");
  assert.equal(areaOf("src/components/x.tsx", ["src/components/**"]), "src/components/x.tsx".split("/").slice(0, 3).join("/"));
});
