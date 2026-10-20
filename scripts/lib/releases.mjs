// Published stable GitHub releases are the default distribution channel.
export function stableVersion(value) {
  return typeof value === "string" && value.trim() === value && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
}

export function compareVersions(left, right) {
  if (!stableVersion(left) || !stableVersion(right)) throw new Error("Expected stable major.minor.patch versions.");
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function githubRepository(source) {
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/.exec(source);
  return match ? `${match[1]}/${match[2].replace(/\.git$/, "")}` : null;
}

export async function latestRelease(source, { timeoutMs = 60000, fetcher = fetch } = {}) {
  const repository = githubRepository(source);
  if (!repository) throw new Error("Release updates require a github.com repository URL; use updates.revision or an explicit local --from for other sources.");
  const response = await fetcher(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "staff-engineer" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  // GitHub returns 404 when there is no published stable release (also for an
  // inaccessible repository). Neither case permits falling back to a branch.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}).`);
  const release = await response.json();
  const version = release.tag_name?.replace(/^v/, "");
  if (release.draft !== false || release.prerelease !== false || !release.published_at || !stableVersion(version) || release.tag_name !== `v${version}`) {
    throw new Error("The latest release must be published, stable, and tagged v<major.minor.patch>.");
  }
  return { tag: release.tag_name, version };
}
