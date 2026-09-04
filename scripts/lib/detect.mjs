// Stack detection: proposes gate commands, preview settings, source globs, and
// plain-language questions for anything it cannot infer. Fills gaps only, in order.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { GATE_NAMES } from "./config.mjs";
import { listFiles } from "./fs-safe.mjs";

const QUESTIONS = {
  install: "How do you install this project's dependencies before working on it?",
  format: "Is there a code-formatting check you normally run? (Say 'none' if not.)",
  lint: "Is there a code-style or lint check you normally run? (Say 'none' if not.)",
  typecheck: "Is there a type check or compile check you normally run? (Say 'none' if not.)",
  test: "How do you run the automated tests for this project? (If there are none yet, say so.)",
  e2e: "Is there a slower end-to-end or browser test suite? (Say 'none' if not.)",
  build: "How do you build or package the project for release? (Say 'none' if not needed.)",
  preview: "How do you normally start the project to look at it or try it out? A web address, a command to run, or 'I look at the files directly'.",
};

export function detectStack(root) {
  const result = {
    detected: [],
    languages: [],
    packageManager: null,
    gates: {},
    preview: null,
    paths: { source: [] },
    questions: [],
    notes: [],
  };
  const context = { root, result, has: (rel) => existsSync(join(root, rel)), read: (rel) => safeRead(join(root, rel)) };

  for (const detector of [detectNode, detectPython, detectGo, detectRust, detectRuby, detectJava, detectSwift, detectPhp, detectMakefile, detectStatic]) {
    detector(context);
  }
  if (!result.languages.length) inferLanguagesFromFiles(context);
  if (!result.paths.source.length) result.paths.source = defaultSourceGlobs(result.languages);
  if (!result.preview) result.questions.push(question("preview"));
  for (const name of GATE_NAMES) {
    if (!Object.hasOwn(result.gates, name)) result.questions.push(question(`gates.${name}`, QUESTIONS[name]));
  }
  result.languages = [...new Set(result.languages)];
  return result;
}

function question(key, text = QUESTIONS[key.replace(/^gates\./, "")]) {
  return { key, question: text };
}

function setGate(result, name, gate) {
  if (!Object.hasOwn(result.gates, name)) result.gates[name] = gate;
}

function addSource(result, root, candidates) {
  for (const dir of candidates) {
    if (existsSync(join(root, dir)) && statSync(join(root, dir)).isDirectory()) result.paths.source.push(`${dir}/**`);
  }
}

// ---------- Node / JavaScript / TypeScript ----------
function detectNode({ root, result, has, read }) {
  if (!has("package.json")) return;
  let pkg;
  try {
    pkg = JSON.parse(read("package.json"));
  } catch {
    result.notes.push("package.json could not be parsed.");
    return;
  }
  const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lockb") || has("bun.lock") ? "bun" : "npm";
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const scripts = pkg.scripts ?? {};
  const isTs = has("tsconfig.json") || "typescript" in deps;
  result.detected.push({ marker: "package.json", kind: "node", packageManager: pm });
  result.packageManager = pm;
  result.languages.push(isTs ? "typescript" : "javascript");
  if (isTs && Object.keys(deps).some((d) => /^(react|vue|svelte|next|nuxt)$/.test(d))) result.languages.push("javascript");

  const run = (name) => (pm === "yarn" ? `yarn ${name}` : pm === "npm" && name === "test" ? "npm test" : `${pm} run ${name}`);
  const installCmd = { npm: "npm ci", pnpm: "pnpm install --frozen-lockfile", yarn: "yarn install --frozen-lockfile", bun: "bun install --frozen-lockfile" }[pm];
  setGate(result, "install", { cmd: installCmd });

  const script = (...names) => names.find((n) => typeof scripts[n] === "string" && scripts[n].trim());
  const fmt = script("format:check", "format", "fmt", "prettier");
  if (fmt) setGate(result, "format", { cmd: run(fmt), ...(scripts["format:write"] || scripts["format:fix"] ? { fix: run(scripts["format:write"] ? "format:write" : "format:fix") } : {}) });
  else if ("prettier" in deps) setGate(result, "format", { cmd: "npx prettier --check .", fix: "npx prettier --write ." });

  const lint = script("lint");
  if (lint) setGate(result, "lint", { cmd: run(lint), ...(scripts["lint:fix"] ? { fix: run("lint:fix") } : {}) });
  else if ("eslint" in deps) setGate(result, "lint", { cmd: "npx eslint .", fix: "npx eslint . --fix" });
  else if ("biome" in deps || "@biomejs/biome" in deps) setGate(result, "lint", { cmd: "npx biome check .", fix: "npx biome check --write ." });

  const typecheck = script("typecheck", "type-check", "check-types", "tsc");
  if (typecheck) setGate(result, "typecheck", { cmd: run(typecheck) });
  else if (isTs) setGate(result, "typecheck", { cmd: "npx tsc --noEmit" });
  else setGate(result, "typecheck", null);

  const test = script("test");
  const isPlaceholder = test && /no test specified/.test(scripts[test]);
  if (test && !isPlaceholder) {
    const gate = { cmd: run(test) };
    if ("vitest" in deps) gate.affected = "npx vitest run {files}";
    else if ("jest" in deps) gate.affected = "npx jest --findRelatedTests {files}";
    setGate(result, "test", gate);
  } else if ("vitest" in deps) setGate(result, "test", { cmd: "npx vitest run", affected: "npx vitest run {files}" });
  else if ("jest" in deps) setGate(result, "test", { cmd: "npx jest", affected: "npx jest --findRelatedTests {files}" });

  const e2e = script("test:e2e", "e2e", "test:browser", "test:smoke");
  if (e2e) setGate(result, "e2e", { cmd: run(e2e) });
  else if ("@playwright/test" in deps) setGate(result, "e2e", { cmd: "npx playwright test" });
  else if ("cypress" in deps) setGate(result, "e2e", { cmd: "npx cypress run" });
  else setGate(result, "e2e", null);

  const build = script("build");
  if (build) setGate(result, "build", { cmd: run(build) });
  else if (!pkg.private && pkg.main) setGate(result, "build", null);

  const dev = script("dev", "start", "serve", "preview");
  if (dev) {
    const port = "next" in deps || "nuxt" in deps || "@remix-run/react" in deps || "express" in deps ? 3000
      : "vite" in deps || "@sveltejs/kit" in deps ? 5173
      : "astro" in deps ? 4321
      : "@angular/core" in deps ? 4200
      : "gatsby" in deps ? 8000
      : "@docusaurus/core" in deps ? 3000
      : null;
    const isWebFramework = port !== null || Object.keys(deps).some((d) => /^(react|vue|svelte|preact|solid-js|lit)$/.test(d));
    if (isWebFramework) {
      result.preview = { kind: "web", cmd: run(dev), url: `http://localhost:${port ?? 3000}`, readyPattern: "ready|listening|Local:|started", timeoutMs: 90000 };
      if (port === null) result.questions.push(question("preview.url", "The project starts with a web address; which one do you open to see it? (For example http://localhost:3000)"));
    } else if (pkg.bin) {
      result.preview = { kind: "command", cmd: run(dev) };
    } else {
      result.preview = { kind: "command", cmd: run(dev) };
      result.questions.push(question("preview", QUESTIONS.preview));
    }
  } else if (pkg.bin) {
    const bin = typeof pkg.bin === "string" ? pkg.name : Object.keys(pkg.bin)[0];
    result.preview = { kind: "command", cmd: `node ${typeof pkg.bin === "string" ? pkg.bin : pkg.bin[bin]} --help` };
  }

  addSource(result, root, ["src", "app", "lib", "pages", "components", "server", "packages"]);
  if (!result.paths.source.length) result.paths.source = ["**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,vue,svelte}", "!node_modules/**"];
}

// ---------- Python ----------
function detectPython({ root, result, has, read }) {
  const hasPyproject = has("pyproject.toml");
  if (!hasPyproject && !has("requirements.txt") && !has("setup.py") && !has("Pipfile")) return;
  const pyproject = hasPyproject ? read("pyproject.toml") : "";
  const requirements = [read("requirements.txt"), read("requirements-dev.txt"), read("dev-requirements.txt")].filter(Boolean).join("\n");
  const text = `${pyproject}\n${requirements}`;
  const pm = has("uv.lock") ? "uv" : has("poetry.lock") || /\[tool\.poetry\]/.test(pyproject) ? "poetry" : has("Pipfile") ? "pipenv" : "pip";
  const prefix = { uv: "uv run ", poetry: "poetry run ", pipenv: "pipenv run ", pip: "" }[pm];
  const mentions = (name) => new RegExp(`(^|[\\s"'\\[])${name}([\\s"'=<>\\]]|$)`, "m").test(text) || new RegExp(`\\[tool\\.${name}`).test(pyproject);
  result.detected.push({ marker: hasPyproject ? "pyproject.toml" : "requirements.txt", kind: "python", packageManager: pm });
  result.languages.push("python");
  result.packageManager ??= pm;

  setGate(result, "install", { cmd: { uv: "uv sync", poetry: "poetry install", pipenv: "pipenv install --dev", pip: "pip install -r requirements.txt" }[pm] });
  if (mentions("ruff")) {
    setGate(result, "format", { cmd: `${prefix}ruff format --check .`, fix: `${prefix}ruff format .` });
    setGate(result, "lint", { cmd: `${prefix}ruff check .`, fix: `${prefix}ruff check --fix .` });
  } else {
    if (mentions("black")) setGate(result, "format", { cmd: `${prefix}black --check .`, fix: `${prefix}black .` });
    if (mentions("flake8")) setGate(result, "lint", { cmd: `${prefix}flake8` });
    else if (mentions("pylint")) setGate(result, "lint", { cmd: `${prefix}pylint .` });
  }
  if (mentions("mypy")) setGate(result, "typecheck", { cmd: `${prefix}mypy .` });
  else if (mentions("pyright")) setGate(result, "typecheck", { cmd: `${prefix}pyright` });
  if (mentions("pytest") || has("tests") || has("test")) setGate(result, "test", { cmd: `${prefix}pytest -q`, affected: `${prefix}pytest -q {files}` });
  if (/\[build-system\]/.test(pyproject) && !has("manage.py")) setGate(result, "build", { cmd: `${prefix}python -m build` });
  else setGate(result, "build", null);
  setGate(result, "e2e", null);

  if (has("manage.py")) result.preview ??= { kind: "web", cmd: `${prefix}python manage.py runserver`, url: "http://localhost:8000", readyPattern: "Starting development server", timeoutMs: 60000 };
  else if (mentions("flask")) result.preview ??= { kind: "web", cmd: `${prefix}flask run`, url: "http://localhost:5000", readyPattern: "Running on", timeoutMs: 60000 };
  else if (mentions("fastapi") || mentions("uvicorn")) {
    result.preview ??= { kind: "web", cmd: `${prefix}uvicorn app.main:app --reload`, url: "http://localhost:8000", readyPattern: "Uvicorn running", timeoutMs: 60000 };
    result.questions.push(question("preview.cmd", "Which command starts the web server for this project? (For example: uvicorn app.main:app --reload)"));
  } else if (mentions("streamlit")) result.preview ??= { kind: "web", cmd: `${prefix}streamlit run app.py`, url: "http://localhost:8501", readyPattern: "You can now view", timeoutMs: 60000 };

  addSource(result, root, ["src", "app"]);
  if (!result.paths.source.length) {
    const packages = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "__init__.py")) && !/^(tests?|spec)$/.test(entry.name))
      .map((entry) => `${entry.name}/**`);
    result.paths.source.push(...(packages.length ? packages : ["**/*.py", "!tests/**", "!test/**"]));
  }
}

// ---------- Go ----------
function detectGo({ result, has }) {
  if (!has("go.mod")) return;
  result.detected.push({ marker: "go.mod", kind: "go" });
  result.languages.push("go");
  setGate(result, "install", { cmd: "go mod download" });
  setGate(result, "format", null);
  setGate(result, "lint", { cmd: has(".golangci.yml") || has(".golangci.yaml") ? "golangci-lint run" : "go vet ./..." });
  setGate(result, "typecheck", { cmd: "go build ./..." });
  setGate(result, "test", { cmd: "go test ./...", affected: "go test {files}" });
  setGate(result, "e2e", null);
  setGate(result, "build", { cmd: "go build ./..." });
  if (has("main.go")) result.preview ??= { kind: "command", cmd: "go run ." };
  result.paths.source.push("**/*.go", "!**/*_test.go");
}

// ---------- Rust ----------
function detectRust({ result, has }) {
  if (!has("Cargo.toml")) return;
  result.detected.push({ marker: "Cargo.toml", kind: "rust" });
  result.languages.push("rust");
  setGate(result, "install", { cmd: "cargo fetch" });
  setGate(result, "format", { cmd: "cargo fmt --check", fix: "cargo fmt" });
  setGate(result, "lint", { cmd: "cargo clippy --all-targets -- -D warnings" });
  setGate(result, "typecheck", { cmd: "cargo check" });
  setGate(result, "test", { cmd: "cargo test" });
  setGate(result, "e2e", null);
  setGate(result, "build", { cmd: "cargo build" });
  if (has("src/main.rs")) result.preview ??= { kind: "command", cmd: "cargo run" };
  result.paths.source.push("src/**");
}

// ---------- Ruby ----------
function detectRuby({ root, result, has, read }) {
  if (!has("Gemfile")) return;
  const gemfile = read("Gemfile") ?? "";
  result.detected.push({ marker: "Gemfile", kind: "ruby" });
  result.languages.push("ruby");
  result.packageManager ??= "bundler";
  setGate(result, "install", { cmd: "bundle install" });
  if (/rubocop/.test(gemfile) || has(".rubocop.yml")) setGate(result, "lint", { cmd: "bundle exec rubocop", fix: "bundle exec rubocop -a" });
  setGate(result, "format", null);
  setGate(result, "typecheck", /sorbet/.test(gemfile) ? { cmd: "bundle exec srb tc" } : null);
  if (has("spec")) setGate(result, "test", { cmd: "bundle exec rspec", affected: "bundle exec rspec {files}" });
  else if (has("test")) setGate(result, "test", { cmd: "bundle exec rake test" });
  setGate(result, "e2e", null);
  setGate(result, "build", null);
  if (has("config/application.rb")) result.preview ??= { kind: "web", cmd: "bin/rails server", url: "http://localhost:3000", readyPattern: "Listening on", timeoutMs: 90000 };
  addSource(result, root, ["app", "lib"]);
}

// ---------- Java / Kotlin ----------
function detectJava({ root, result, has }) {
  const maven = has("pom.xml");
  const gradle = has("build.gradle") || has("build.gradle.kts");
  if (!maven && !gradle) return;
  result.detected.push({ marker: maven ? "pom.xml" : "build.gradle", kind: "java" });
  result.languages.push(has("build.gradle.kts") || existsSync(join(root, "src/main/kotlin")) ? "kotlin" : "java");
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  setGate(result, "install", maven ? { cmd: "mvn -q dependency:resolve" } : { cmd: `${gradlew} dependencies --quiet` });
  setGate(result, "format", null);
  setGate(result, "lint", null);
  setGate(result, "typecheck", maven ? { cmd: "mvn -q compile" } : { cmd: `${gradlew} compileJava --quiet` });
  setGate(result, "test", maven ? { cmd: "mvn -q test" } : { cmd: `${gradlew} test` });
  setGate(result, "e2e", null);
  setGate(result, "build", maven ? { cmd: "mvn -q package -DskipTests" } : { cmd: `${gradlew} build -x test` });
  addSource(result, root, ["src/main"]);
}

// ---------- Swift ----------
function detectSwift({ root, result, has }) {
  if (!has("Package.swift")) return;
  result.detected.push({ marker: "Package.swift", kind: "swift" });
  result.languages.push("swift");
  setGate(result, "install", { cmd: "swift package resolve" });
  setGate(result, "format", null);
  setGate(result, "lint", has(".swiftlint.yml") ? { cmd: "swiftlint" } : null);
  setGate(result, "typecheck", { cmd: "swift build" });
  setGate(result, "test", { cmd: "swift test" });
  setGate(result, "e2e", null);
  setGate(result, "build", { cmd: "swift build" });
  addSource(result, root, ["Sources"]);
}

// ---------- PHP ----------
function detectPhp({ root, result, has, read }) {
  if (!has("composer.json")) return;
  const composer = read("composer.json") ?? "";
  result.detected.push({ marker: "composer.json", kind: "php" });
  result.languages.push("php");
  result.packageManager ??= "composer";
  setGate(result, "install", { cmd: "composer install" });
  setGate(result, "format", /php-cs-fixer/.test(composer) ? { cmd: "vendor/bin/php-cs-fixer fix --dry-run", fix: "vendor/bin/php-cs-fixer fix" } : null);
  setGate(result, "lint", /phpstan/.test(composer) ? { cmd: "vendor/bin/phpstan analyse" } : null);
  setGate(result, "typecheck", null);
  if (/phpunit/.test(composer)) setGate(result, "test", { cmd: "vendor/bin/phpunit" });
  else if (/pestphp/.test(composer)) setGate(result, "test", { cmd: "vendor/bin/pest" });
  setGate(result, "e2e", null);
  setGate(result, "build", null);
  if (has("artisan")) result.preview ??= { kind: "web", cmd: "php artisan serve", url: "http://localhost:8000", readyPattern: "Server running", timeoutMs: 60000 };
  addSource(result, root, ["src", "app"]);
}

// ---------- Makefile (fills gaps only) ----------
function detectMakefile({ result, has, read }) {
  if (!has("Makefile") && !has("makefile")) return;
  const text = read(has("Makefile") ? "Makefile" : "makefile") ?? "";
  const targets = new Set([...text.matchAll(/^([A-Za-z0-9_.-]+)\s*:(?!=)/gm)].map((m) => m[1]));
  result.detected.push({ marker: "Makefile", kind: "make", targets: [...targets] });
  const pick = (name, ...candidates) => {
    const target = candidates.find((c) => targets.has(c));
    if (target) setGate(result, name, { cmd: `make ${target}` });
  };
  pick("install", "install", "deps", "setup", "bootstrap");
  pick("format", "fmt", "format", "format-check");
  pick("lint", "lint", "check");
  pick("typecheck", "typecheck", "types");
  pick("test", "test", "tests");
  pick("e2e", "e2e", "test-e2e", "integration");
  pick("build", "build", "dist");
  const dev = ["dev", "run", "serve", "start"].find((c) => targets.has(c));
  if (dev && !result.preview) {
    result.preview = { kind: "command", cmd: `make ${dev}` };
    result.questions.push(question("preview", `The project can be started with "make ${dev}". Does that open a web address you look at, or is it a program you run directly?`));
  }
}

// ---------- Static site ----------
function detectStatic({ result, has }) {
  if (result.detected.length || !has("index.html")) return;
  result.detected.push({ marker: "index.html", kind: "static" });
  result.languages.push("javascript");
  for (const name of ["install", "format", "lint", "typecheck", "test", "e2e", "build"]) setGate(result, name, null);
  result.preview = { kind: "web", cmd: "npx --yes serve -l 3000 .", url: "http://localhost:3000", readyPattern: "Accepting connections|Local:", timeoutMs: 60000 };
  result.questions.push(question("preview", "This looks like a plain website. Do you open it by starting a small local server, or by opening the files directly in a browser?"));
  result.paths.source.push("**/*.html", "**/*.css", "**/*.js", "!node_modules/**");
}

function inferLanguagesFromFiles({ root, result }) {
  const counts = new Map();
  let files = [];
  try {
    files = listFiles(root, { ignore: ["node_modules", ".git", "vendor", "dist", "build", "target", ".staff-engineer", ".agents"] }).slice(0, 5000);
  } catch {
    return;
  }
  for (const file of files) {
    const language = languageForExtension(extname(file));
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  result.languages.push(...[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([language]) => language));
}

export function languageForExtension(ext) {
  const table = {
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript", ".vue": "javascript", ".svelte": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
    ".py": "python", ".go": "go", ".rs": "rust", ".rb": "ruby", ".rake": "ruby", ".java": "java", ".kt": "kotlin", ".kts": "kotlin",
    ".swift": "swift", ".php": "php", ".cs": "csharp", ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  };
  return table[ext] ?? null;
}

function defaultSourceGlobs(languages) {
  const byLanguage = {
    javascript: ["**/*.{js,mjs,cjs,jsx,vue,svelte}"], typescript: ["**/*.{ts,tsx,mts,cts}"], python: ["**/*.py"], go: ["**/*.go"],
    rust: ["**/*.rs"], ruby: ["**/*.rb"], java: ["**/*.java"], kotlin: ["**/*.kt"], swift: ["**/*.swift"], php: ["**/*.php"], csharp: ["**/*.cs"], shell: ["**/*.sh"],
  };
  const globs = languages.flatMap((language) => byLanguage[language] ?? []);
  return globs.length ? [...globs, "!node_modules/**", "!vendor/**"] : [];
}

function safeRead(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
