import { loadConfig } from "../lib/config.mjs";
import { assertLane, laneOf } from "../lib/lanes.mjs";
import { ok } from "../lib/output.mjs";
import { CLI, requireOpenSession, setLane, writeSession } from "../lib/session.mjs";

export const description = "Move the open concern to another lane (trivial, standard, large) when its size or risk changed.";
export const usage = "lane <trivial|standard|large>";

export default async function run({ cwd, positional }) {
  loadConfig(cwd);
  const session = requireOpenSession(cwd);
  const lane = assertLane(positional[0]);
  const previous = laneOf(session);
  const updated = setLane(session, lane);
  writeSession(cwd, updated);
  return ok({
    operator: "",
    agent: previous === lane
      ? `The concern is already in the ${lane} lane.`
      : `Moved from the ${previous} lane to the ${lane} lane. Run ${CLI} next for the step this lane needs now.`,
    data: { lane, previous },
  });
}
