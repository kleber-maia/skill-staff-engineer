// A session baseline records every file that was already dirty when the concern
// began, so pre-existing work can never be swept into the concern's batch.
import { dirtyFiles, stagedFiles, workingTreeHash } from "./git.mjs";
import { isToolkitPath } from "./paths.mjs";

export function captureBaseline(cwd) {
  const files = dirtyFiles(cwd);
  const staged = stagedFiles(cwd);
  const fingerprints = {};
  for (const file of files) fingerprints[file] = workingTreeHash(file, cwd);
  return { files, stagedFiles: staged, fingerprints };
}

export function baselineUnchanged(baseline, cwd) {
  if (!baseline) return true;
  for (const [file, hash] of Object.entries(baseline.fingerprints ?? {})) {
    if (isToolkitPath(file)) continue; // the toolkit edits its own config and exceptions
    if (workingTreeHash(file, cwd) !== hash) return false;
  }
  return true;
}

export function concernFiles(baseline, cwd) {
  const known = new Set(baseline?.files ?? []);
  return dirtyFiles(cwd).filter((file) => !known.has(file));
}
