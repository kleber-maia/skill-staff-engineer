// Shared shim: forward the Claude hook payload to the project's vendored CLI.
// Runs from the plugin or from .staff-engineer/hooks. Always exits 0.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export async function forward(event) {
  try {
    let text = "";
    if (!process.stdin.isTTY) for await (const chunk of process.stdin) text += chunk;
    let payload = {};
    try {
      payload = text.trim() ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }
    const cwd = payload.cwd && existsSync(payload.cwd) ? payload.cwd : process.cwd();
    const root = findRoot(cwd);
    const cli = root ? join(root, ".staff-engineer", "cli.mjs") : null;
    if (!cli || !existsSync(cli)) {
      if (event === "SessionStart" && root && !process.env.STAFF_ENGINEER_QUIET) {
        process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "The staff-engineer plugin is available but not installed in this project. If the operator wants the staff-engineer workflow here, run /staff-engineer:install (see the install skill)." } })}\n`);
      }
      return;
    }
    const result = spawnSync(process.execPath, [cli, "hook", event], { cwd: root, input: text, encoding: "utf8", timeout: 8000, windowsHide: true });
    if (result.stdout) process.stdout.write(result.stdout);
  } catch {
    // fail open
  } finally {
    process.exitCode = 0;
  }
}

function findRoot(start) {
  let dir = resolve(start);
  for (let depth = 0; depth < 30; depth += 1) {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, ".staff-engineer", "cli.mjs"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
