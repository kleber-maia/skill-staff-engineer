// Release is an optional follow-up, never a condition of completing delivery.
export const RELEASE_QUESTION = 'Run the release process? Say “yes” and I’ll follow this project’s release playbook, including publication if it calls for it.';
export const RELEASE_GUIDANCE = 'Relay the release question once with the completion message. No answer or no leaves the task complete; do not remind or block the next task. A clear yes to this question starts the project release playbook: read .agents/skills/staff-engineer/release.md. Preserve any separate approval requirements.';

export function releaseFollowup(session, { now = new Date().toISOString() } = {}) {
  if (session.status !== "synced" || !session.savedCommit || session.releaseOffer) return { session, offer: null };
  const offer = { commit: session.savedCommit, offeredAt: now, question: RELEASE_QUESTION };
  return { session: { ...session, releaseOffer: offer }, offer };
}
