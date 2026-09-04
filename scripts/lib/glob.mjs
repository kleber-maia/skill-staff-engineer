// Dependency-free glob matching for repo-relative POSIX paths.
// Supports **, *, ?, {a,b}, and a leading ! for negation inside lists.
// A pattern without a slash matches the basename at any depth ("*.log" == "**/*.log").

const cache = new Map();

export function globToRegExp(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  let source = pattern.replace(/\\/g, "/");
  if (source.startsWith("./")) source = source.slice(2);
  if (!source.includes("/")) source = `**/${source}`;
  if (source.endsWith("/")) source = `${source}**`;

  let out = "^";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "*") {
      if (source[index + 1] === "*") {
        const followedBySlash = source[index + 2] === "/";
        out += followedBySlash ? "(?:.*/)?" : ".*";
        index += followedBySlash ? 2 : 1;
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "{") {
      const close = source.indexOf("}", index);
      if (close === -1) {
        out += "\\{";
      } else {
        const options = source.slice(index + 1, close).split(",").map(escape);
        out += `(?:${options.join("|")})`;
        index = close;
      }
    } else {
      out += escape(char);
    }
  }
  out += "$";
  const regexp = new RegExp(out);
  cache.set(pattern, regexp);
  return regexp;
}

export function matches(path, pattern) {
  return globToRegExp(pattern).test(normalize(path));
}

export function matchesAny(path, patterns = []) {
  const normalized = normalize(path);
  let matched = false;
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      if (globToRegExp(pattern.slice(1)).test(normalized)) matched = false;
    } else if (globToRegExp(pattern).test(normalized)) {
      matched = true;
    }
  }
  return matched;
}

export function normalize(path) {
  let value = String(path).replace(/\\/g, "/");
  if (value.startsWith("./")) value = value.slice(2);
  return value;
}

function escape(text) {
  return text.replace(/[.+^$()|[\]\\]/g, "\\$&");
}
