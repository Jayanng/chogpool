// Draft Night gating: a pick is only ever saved under a real race ID and only
// while that race is actually open on chain. DrawEngine.currentDrawId stays on
// the latest draw after it finalizes (it reads 1 while draw 1 is finalized and
// no draw 2 exists), so "there is a draw id" is not "there is a race to draft
// for": only DrawState.Open counts. The dev fixture flow is exempt on purpose:
// fixture draw 2 is a rehearsal record, not chain state, and its draft flow
// rehearses the pick mechanics unchanged.

import type { DrawStateName } from "../types/race";

export type DraftGate = {
  /** The draw id the page would draft for, or "next" before one is known. */
  drawKey: string;
  /** That draw's DrawState, or null when the chain did not answer. */
  drawState: DrawStateName | null;
  /** True only in the dev fixture flow (VITE_FIXTURES=1). */
  fixtures: boolean;
};

export function raceIsDraftable({ drawKey, drawState, fixtures }: DraftGate): boolean {
  if (drawKey === "next") return false;
  // A rehearsal draw is not chain state and its record reads "finalized";
  // the fixture flow keeps drafting against it exactly as before.
  if (fixtures) return true;
  // A state read that did not answer is not an open draw. The page then shows
  // the honest "no race open" state instead of offering picks it cannot back.
  return drawState === "open";
}
