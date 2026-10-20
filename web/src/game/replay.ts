// The run's story, derived from the run itself. Given a record (and the
// ghost it raced) this replays the tape through the same pure sim and
// produces the commentary events and the finish margin. Nothing here is
// written by hand at play time: every event comes from what the tape did.

import { courseOf } from "./course";
import { coinsOf, initialRun, revive, step, type RunState } from "./sim";
import type { RunRecord } from "./runRecord";

export type ReplayEvent = {
  /** distance in px where the moment happened */
  at: number;
  text: string;
};

export type RunStory = {
  events: ReplayEvent[];
  /** final score of the run */
  score: number;
  distance: number;
  coins: number;
  closeCalls: number;
  cleared: boolean;
  revived: boolean;
  /** margin against the ghost's score, null when there is no ghost */
  margin: number | null;
  marginLabel: string | null;
  /** the states of the run, one per tape press, for the stage to play */
  frames: RunState[];
};

/** Replay a record into its story. Pure: same record, same story, forever. */
export function runStory(record: RunRecord, ghost?: RunRecord | null): RunStory {
  const course = courseOf(record.seed, record.lengthPx);
  const coins = coinsOf(course, record.seed);
  const frames: RunState[] = [];
  const events: ReplayEvent[] = [];

  let s = initialRun();
  let lastCoins = 0;
  let reviveUsed = false;
  for (let i = 0; i < record.inputs.length; i++) {
    if (record.reviveAt !== null && i === record.reviveAt && !reviveUsed) {
      s = revive(s);
      reviveUsed = true;
      events.push({ at: s.distance, text: "The revive is used. One life, spent well." });
    }
    s = step(s, record.inputs[i], course, coins);
    frames.push(s);
    if (!s.alive) {
      events.push({ at: s.distance, text: `Down at ${Math.floor(s.distance / 10)}m.` });
      break;
    }
    if (s.coins > lastCoins) {
      events.push({ at: s.distance, text: `Coin banked. ${s.coins} collected.` });
      lastCoins = s.coins;
    }
    if (s.closeCalls > 0 && s.juice === 12) {
      events.push({ at: s.distance, text: `Close call at ${Math.floor(s.distance / 10)}m. Right on the edge.` });
    }
    if (s.distance >= record.lengthPx && frames.length > 0) {
      events.push({ at: s.distance, text: "Course clear. The run reaches the line." });
      break;
    }
  }

  const final = frames[frames.length - 1] ?? s;
  const cleared = final.distance >= record.lengthPx;
  if (cleared) {
    events.push({ at: final.distance, text: `Across the line with ${final.score} points.` });
  }

  let margin: number | null = null;
  let marginLabel: string | null = null;
  if (ghost) {
    const g = runStory(ghost, null);
    margin = final.score - g.score;
    const pct = g.score > 0 ? (Math.abs(margin) / g.score) * 100 : null;
    marginLabel =
      margin > 0
        ? `WON BY ${pct !== null ? pct.toFixed(1) : "?"}%`
        : margin === 0
          ? "LEVEL WITH THE GHOST"
          : `BEHIND BY ${pct !== null ? pct.toFixed(1) : "?"}%`;
  }

  return {
    events,
    score: final.score,
    distance: final.distance,
    coins: final.coins,
    closeCalls: final.closeCalls,
    cleared,
    revived: record.reviveAt !== null,
    margin,
    marginLabel,
    frames,
  };
}
