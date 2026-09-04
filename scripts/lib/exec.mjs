import { spawnSync } from "node:child_process";

// Run a program directly (no shell). Throws on non-zero exit.
export function output(command, args = [], { cwd = process.cwd(), env = process.env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})${detail ? `: ${detail}` : ""}`);
  }
  return (result.stdout ?? "").trim();
}

// Run a user-configured command line through the platform shell, capturing output.
export function runShell(commandLine, { cwd = process.cwd(), env = process.env, timeoutMs = 15 * 60 * 1000 } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(commandLine, {
    cwd,
    env,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const timedOut = result.error?.code === "ETIMEDOUT";
  return {
    command: commandLine,
    status: timedOut ? null : result.status,
    ok: !timedOut && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut,
    durationMs: Date.now() - startedAt,
    error: result.error && !timedOut ? String(result.error.message) : null,
  };
}

export function commandExists(name, { cwd = process.cwd() } = {}) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [name], { cwd, encoding: "utf8", windowsHide: true });
  return result.status === 0;
}
