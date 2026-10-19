// Draft Night only offers picks while the race is open on chain. The pinned
// case: draw 1 finalized (stateOf(1) = 4) with currentDrawId still 1 must read
// as "no race open", with pick buttons disabled, instead of "DRAFTING FOR
// RACE 1". The dev fixture rehearsal flow stays exactly as it was.

import { describe, expect, it } from "vitest";
import { raceIsDraftable } from "./gate";

describe("Draft Night gates picks on the draw being open", () => {
  it("gates a finalized draw out even though currentDrawId still names it", () => {
    // The judge-path case: DrawEngine.currentDrawId = 1, stateOf(1) = finalized.
    expect(raceIsDraftable({ drawKey: "1", drawState: "finalized", fixtures: false })).toBe(false);
  });

  it("lets an open draw through", () => {
    expect(raceIsDraftable({ drawKey: "2", drawState: "open", fixtures: false })).toBe(true);
  });

  it("gates every non-open chain state out", () => {
    for (const drawState of ["none", "closed", "awarded", "finalized"] as const) {
      expect(raceIsDraftable({ drawKey: "3", drawState, fixtures: false })).toBe(false);
    }
  });

  it("treats a state read that did not answer as not draftable", () => {
    expect(raceIsDraftable({ drawKey: "1", drawState: null, fixtures: false })).toBe(false);
  });

  it("never drafts under the 'next' placeholder, whatever the state", () => {
    expect(raceIsDraftable({ drawKey: "next", drawState: "open", fixtures: false })).toBe(false);
    expect(raceIsDraftable({ drawKey: "next", drawState: null, fixtures: true })).toBe(false);
  });

  it("keeps the dev fixture rehearsal flow unchanged", () => {
    // Fixture draw 2's record reads "finalized" because it is a rehearsal of a
    // finalized draw; the fixture flow still drafts against it.
    expect(raceIsDraftable({ drawKey: "2", drawState: "finalized", fixtures: true })).toBe(true);
    expect(raceIsDraftable({ drawKey: "2", drawState: null, fixtures: true })).toBe(true);
  });
});
