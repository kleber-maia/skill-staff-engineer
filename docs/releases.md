# Releases

Pushing code and publishing a release are separate decisions. After every successful push to
this repository, the agent asks the operator whether to publish a GitHub release. Only an
explicit approval for the proposed tag and commit authorizes publication.

## Prepare and publish

1. Choose a new stable `major.minor.patch` version. Use patch for compatible fixes, minor for
   features, and major for breaking changes once at 1.0. Before 1.0, breaking changes increment
   minor. Keep `package.json` and `.claude-plugin/plugin.json` equal and add a meaningful entry
   in `CHANGELOG.md`. Version numbers are chosen deliberately, not incremented on every push.
2. Run `npm test`, commit, and push. Refresh remote tags and `origin/main`, then run
   `npm run release:check -- --tag v<version> --commit <full-pushed-sha>` from a clean checkout.
   This read-only preflight checks version agreement, release notes, that the exact commit is
   on `origin/main`, and that the version is newer than existing stable tags.
   The test entry point enumerates toolkit test files explicitly so Node 20 and Windows do not
   depend on shell glob expansion; fixtures are not executed as toolkit tests.
3. Ask the operator whether to publish that tag and commit. If declined, leave the pushed work
   unreleased. If the current version was already released, prepare a new version before
   proposing publication; never reuse an existing release tag.
4. After approval, dispatch the **Release** workflow on `main` with the approved `tag` and
   full `commit` SHA. For example, the agent runs:

   ```bash
   gh workflow run release.yml --ref main -f tag=v<version> -f commit=<full-pushed-sha>
   ```

   The workflow checks out that exact commit, fetches history and tags, runs the release
   preflight and tests, then packages that commit as `staff-engineer.zip`, uploads it to a draft
   release, and publishes the tag and release with the changelog notes. Publication happens
   after the asset upload succeeds. It runs only on manual dispatch, never on a push. Confirm
   workflow completion and the published release before reporting delivery. A failed run must be inspected before
   retrying; do not delete or move a tag to recover.

## Installed projects

With `updates.revision: null` (the default), updates query GitHub's latest published stable
release and fetch its exact `v<version>` tag. The package and plugin versions must match the
tag before any project files change. Drafts, prereleases, unreleased branch commits, and
equal or older versions are not installed. No published release means no update; a network
failure follows the configured offline policy. No fallback to the default branch occurs.

An explicit `updates.revision` remains a deliberate branch, tag, or commit override, including
for non-GitHub sources. An explicit local `update --from <path>` supports development. Merely
recording a local source directory does not opt a project out of release updates.

Install new projects from a published release tag. Download a release's source archive, or
clone with `git clone --branch v<released-version> --depth 1 <repository-url> <toolkit>` before
running the installer. A normal clone or an unpinned Git-based npm command selects development
code; use it only deliberately. The Claude marketplace downloads `staff-engineer.zip` from the
latest published release, so an ordinary push cannot update plugin code either. This uses
Claude Code's [archive plugin source](https://code.claude.com/docs/en/plugins/marketplace-reference#archive-plugin-source)
(requires 2.1.224 or newer). Plugin update timing remains controlled by the host; enable
marketplace auto-updates or request a plugin update there. For local development use
`claude --plugin-dir <toolkit>`, rather than the release marketplace.

Installations from 0.8.0 or earlier still contain the old branch-following updater. They need
one transition update to acquire this release-aware code; it cannot change an already installed
old updater remotely. Installing from a published 0.9.0-or-newer tag is the direct migration
path. After migration, ordinary pushes no longer distribute changes to those projects.
