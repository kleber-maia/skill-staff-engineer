#!/usr/bin/env node
// staff-engineer toolkit CLI. Usage: node .staff-engineer/cli.mjs <command> [options] [--json]
import { parseArgs } from "./lib/args.mjs";
import { isRepo, repoRoot } from "./lib/git.mjs";
import { EXIT, fromError, render } from "./lib/output.mjs";
import { pathToFileURL } from "node:url";

import { toolkitVersion } from "./lib/toolkit.mjs";

export const COMMANDS = {
  install: { module: "./commands/install.mjs", multi: ["skip"] },
  doctor: { module: "./commands/doctor.mjs" },
  config: { module: "./commands/config.mjs" },
  status: { module: "./commands/status.mjs" },
  begin: { module: "./commands/begin.mjs" },
  brief: { module: "./commands/brief.mjs", multi: ["accept", "non-goal", "surface"] },
  preview: { module: "./commands/preview.mjs" },
  revise: { module: "./commands/revise.mjs" },
  finalize: { module: "./commands/finalize.mjs" },
  lifecycle: { module: "./commands/lifecycle.mjs" },
  verify: { module: "./commands/verify.mjs" },
  handoff: { module: "./commands/handoff.mjs" },
  ship: { module: "./commands/ship.mjs" },
  abort: { module: "./commands/abort.mjs" },
  exception: { module: "./commands/exception.mjs" },
  context: { module: "./commands/context.mjs" },
  update: { module: "./commands/update.mjs" },
  hook: { module: "./commands/hook.mjs" },
};

const BOOLEANS = ["json", "dry-run", "yes", "reconfigure", "replace-existing-skills", "with-claude-hooks", "init-git", "uninstall", "push", "sync-only", "discard-confirmed", "which", "force"];

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const [name, ...rest] = argv;
  const json = rest.includes("--json");

  if (!name || name === "help" || name === "--help" || name === "-h") {
    stdout.write(helpText());
    return EXIT.OK;
  }
  if (name === "version" || name === "--version" || name === "-v") {
    stdout.write(`${toolkitVersion()}\n`);
    return EXIT.OK;
  }
  const spec = COMMANDS[name];
  if (!spec) {
    render(fromError(new Error(`Unknown command "${name}". Run with --help to list commands.`)), { json, stream: stdout, errStream: stderr });
    return EXIT.TOOLING;
  }

  try {
    const { flags, positional } = parseArgs(rest, { multi: spec.multi ?? [], booleans: BOOLEANS });
    const module = await import(spec.module);
    const root = name === "install" || name === "hook" ? cwd : isRepo(cwd) ? repoRoot(cwd) : cwd;
    const result = await module.default({ cwd: root, invokedFrom: cwd, argv: rest, flags, positional, env, stdout, stderr });
    if (name !== "hook") render(result, { json, stream: stdout, errStream: stderr });
    return result.code ?? EXIT.OK;
  } catch (error) {
    if (name === "hook") return EXIT.OK; // hooks always fail open
    render(fromError(error), { json, stream: stdout, errStream: stderr });
    return error?.code ?? EXIT.TOOLING;
  }
}

export function helpText() {
  return `staff-engineer ${toolkitVersion()}

Usage: node .staff-engineer/cli.mjs <command> [options] [--json]

Setup
  install [--target <dir>] [--dry-run] [--yes] [--reconfigure] [--replace-existing-skills] [--with-claude-hooks] [--init-git] [--uninstall]
  doctor [--which]                    Check the installation and list questions for the operator
  config get|set|unset <dotpath> [value]
  update [--from <path|git-url>]      Upgrade the vendored toolkit

Lifecycle (one concern at a time)
  begin "<short concern>"             Open exactly one work session
  context <planned files...>          Build the task-context packet (skills, docs, tests, dependencies)
  brief --outcome "..." --accept "..." [--accept "..."] [--non-goal "..."] [--surface "..."]
  preview                             Present the working result; reads the acceptance checks back
  revise                              Return to implementation after feedback
  finalize                            Record acceptance (needs STAFF_ENGINEER_PREVIEW_APPROVED=1)
  lifecycle                           Gate the staged batch
  verify --mode fast|full             Run the configured checks; full writes a receipt
  handoff                             Print a plain-language handoff draft
  ship "<imperative message>" [--push] Guarded save (needs STAFF_ENGINEER_CHANGE_APPROVED=1)
  ship --sync-only                    Push a saved batch that was not pushed yet
  abort [--discard-confirmed]         Close an abandoned session (never deletes files)
  status                              Show session, brief, and receipt state
  exception add --rule <id> --path <glob> --reason "..."

Every command accepts --json for a machine-readable result.
`;
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const code = await main();
  process.exitCode = code;
}
