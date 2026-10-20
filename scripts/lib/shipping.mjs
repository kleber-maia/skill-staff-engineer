// Resolve one destination and prove that it contains the saved commit. Never let
// push.default, matching refs, tags, or a mirror setting expand the approved batch.
import { output } from "./exec.mjs";
import { currentBranch, lines } from "./git.mjs";
import { failed, refused, tooling } from "./output.mjs";

export function shippingTarget(cwd, config) {
  const options = config.shipping;
  if (options.mode === "local") return null;
  const remotes = lines(output("git", ["remote"], { cwd }));
  if (!remotes.length && !options.remote) return null; // a local project remains usable
  const branch = currentBranch(cwd);
  if (!branch || branch === "HEAD") throw refused("Sending this change needs a named branch.", { agent: "Create or switch to the intended branch before shipping." });
  const get = (key) => output("git", ["config", "--get", key], { cwd, allowFailure: true });
  const upstreamRemote = get(`branch.${branch}.remote`);
  const remote = options.remote || get(`branch.${branch}.pushRemote`) || get("remote.pushDefault") || upstreamRemote
    || (remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : null);
  if (!remote || !remotes.includes(remote)) throw refused("The destination for this saved change is ambiguous or missing.", { agent: "Configure shipping.remote with the intended existing remote before shipping." });
  if (lines(output("git", ["remote", "get-url", "--push", "--all", remote], { cwd })).length !== 1) throw refused("Delivery needs one unambiguous push destination.", { agent: "Configure one push URL for the shipping remote before saving." });
  const ref = options.branch ? `refs/heads/${options.branch}`
    : remote === upstreamRemote && get(`branch.${branch}.merge`) || `refs/heads/${branch}`;
  if (!ref.startsWith("refs/heads/") || !output("git", ["check-ref-format", "--normalize", ref], { cwd, allowFailure: true })) {
    throw refused("The shipping destination must be a valid branch.");
  }
  return { remote, ref, timeoutMs: options.timeoutMs };
}

export function committedTree(cwd, revision) {
  return output("git", ["rev-parse", `${revision}^{tree}`], { cwd });
}

export function commitMatches(cwd, revision, journal) {
  return committedTree(cwd, revision) === journal.expectedTree
    && output("git", ["show", "-s", "--format=%P", revision], { cwd }) === (journal.baseCommit ?? "");
}

function delivered(cwd, commit, target) {
  const urls = lines(output("git", ["remote", "get-url", "--push", "--all", target.remote], { cwd }));
  if (urls.length !== 1) throw refused("Delivery needs one unambiguous push destination.");
  // Confirmation must inspect the push destination, which may differ from the
  // fetch URL. Keep URL values out of the public journal/result metadata.
  const refs = output("git", ["ls-remote", "--refs", urls[0], target.ref], { cwd, timeoutMs: target.timeoutMs });
  const remoteCommit = refs.split(/\s+/)[0];
  if (!remoteCommit) return false;
  if (remoteCommit === commit) return true;
  // Another writer may already have advanced the branch after our delivery.
  output("git", ["fetch", "--quiet", "--no-tags", urls[0], target.ref], { cwd, timeoutMs: target.timeoutMs });
  return output("git", ["merge-base", commit, "FETCH_HEAD"], { cwd, allowFailure: true }) === commit;
}

export function deliver(cwd, commit, target, retryCommand = "ship --sync-only") {
  if (!target) return false;
  try {
    if (!delivered(cwd, commit, target)) {
      output("git", ["-c", "push.followTags=false", "-c", `remote.${target.remote}.mirror=false`, "push", "--porcelain", target.remote, `${commit}:${target.ref}`], { cwd, timeoutMs: target.timeoutMs });
      if (!delivered(cwd, commit, target)) throw failed("The destination does not contain the saved change.");
    }
  } catch (error) {
    throw tooling("The change is saved locally, but delivery has not been confirmed.", {
      agent: `Check the destination and network, then run ${retryCommand}. It retries the same commit; never create a second commit or force-push to recover.`,
      data: { commit, target, deliveryPending: true },
    });
  }
  return true;
}
