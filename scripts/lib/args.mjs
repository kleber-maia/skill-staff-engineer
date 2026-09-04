// Minimal argv parser. Supports --flag, --flag value, --flag=value, repeated flags,
// and positional arguments. `multi` names flags that always collect into arrays.
export function parseArgs(argv, { multi = [], booleans = [] } = {}) {
  const flags = {};
  const positional = [];
  const multiSet = new Set(multi);
  const boolSet = new Set(booleans);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    let name = token.slice(2);
    let value;
    const equals = name.indexOf("=");
    if (equals !== -1) {
      value = name.slice(equals + 1);
      name = name.slice(0, equals);
    } else if (boolSet.has(name)) {
      value = true;
    } else if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
      value = argv[index + 1];
      index += 1;
    } else {
      value = true;
    }
    if (multiSet.has(name)) {
      (flags[name] ??= []).push(value);
    } else {
      flags[name] = value;
    }
  }
  return { flags, positional };
}

export function flag(flags, name, fallback = undefined) {
  return Object.hasOwn(flags, name) ? flags[name] : fallback;
}
