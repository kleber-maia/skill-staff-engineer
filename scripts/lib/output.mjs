// Output contract shared by every CLI command.
//
// Each command resolves to a result object:
//   { ok, code, data, operator, agent, errors }
// - `operator` is one plain-language sentence safe to relay to a non-technical person.
// - `agent` is the next-step hint for the AI agent (may name commands and files).
// With --json the whole object is printed as JSON; otherwise the operator line is
// printed and, on failure, the agent hint.

export const EXIT = Object.freeze({
  OK: 0,
  REFUSED: 1, // lifecycle refused the step (wrong phase, missing approval, ...)
  TOOLING: 2, // the toolkit itself could not run (missing git, bad config, ...)
  FAILED: 3, // a gate or verification ran and failed
});

export class ToolkitError extends Error {
  constructor(message, { code = EXIT.REFUSED, agent = "", errors = [], data = {} } = {}) {
    super(message);
    this.name = "ToolkitError";
    this.code = code;
    this.agent = agent;
    this.errors = errors;
    this.data = data;
  }
}

export function refused(message, options = {}) {
  return new ToolkitError(message, { ...options, code: EXIT.REFUSED });
}

export function tooling(message, options = {}) {
  return new ToolkitError(message, { ...options, code: EXIT.TOOLING });
}

export function failed(message, options = {}) {
  return new ToolkitError(message, { ...options, code: EXIT.FAILED });
}

export function ok({ operator = "Done.", agent = "", data = {} } = {}) {
  return { ok: true, code: EXIT.OK, data, operator, agent, errors: [] };
}

export function fromError(error) {
  if (error instanceof ToolkitError) {
    return {
      ok: false,
      code: error.code,
      data: error.data ?? {},
      operator: error.message,
      agent: error.agent ?? "",
      errors: error.errors?.length ? error.errors : [error.message],
    };
  }
  return {
    ok: false,
    code: EXIT.TOOLING,
    data: {},
    operator: "The toolkit hit an unexpected problem.",
    agent: error?.stack ?? String(error),
    errors: [String(error?.message ?? error)],
  };
}

export function render(result, { json = false, stream = process.stdout, errStream = process.stderr } = {}) {
  if (json) {
    stream.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const target = result.ok ? stream : errStream;
  target.write(`${result.operator}\n`);
  if (!result.ok && result.errors.length > 1) {
    for (const line of result.errors) target.write(`- ${line}\n`);
  }
  if (result.agent) target.write(`${result.agent}\n`);
}
