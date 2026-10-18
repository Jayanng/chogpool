import { describe, expect, it } from "vitest";
import { commentaryOf, gapLabel, marginLabel, marginOf, positionMap, puffStops, type LaneCurve } from "./broadcast";

const A: LaneCurve = { tokenId: 1n, rank: 0, progressCurve: [0.3, 0.6, 0.9, 1.0] };
const B: LaneCurve = { tokenId: 2n, rank: 1, progressCurve: [0.5, 0.7, 0.85, 0.95] };
const C: LaneCurve = { tokenId: 3n, rank: 2, progressCurve: [0.1, 0.2, 0.3, 0.4] };

describe("broadcast layer (presentation only, restates the replay)", () => {
  it("ranks the field by live progress", () => {
    const positions = positionMap(
      [
        { tokenId: "1", progress: 0.3 },
        { tokenId: "2", progress: 0.5 },
        { tokenId: "3", progress: 0.1 },
      ],
      ["1", "2", "3"],
    );
    expect(positions).toEqual({ "2": 1, "1": 2, "3": 3 });
  });

  it("breaks ties by the chain's own finish order", () => {
    const positions = positionMap(
      [
        { tokenId: "1", progress: 0.5 },
        { tokenId: "2", progress: 0.5 },
      ],
      ["1", "2"],
    );
    expect(positions).toEqual({ "1": 1, "2": 2 });
  });

  it("the leader says LEADING and the rest say how far back", () => {
    expect(gapLabel(1, 1)).toBe("LEADING");
    expect(gapLabel(1, 0.968)).toBe("3.2% BACK");
    expect(gapLabel(0.5, 0)).toBe("50.0% BACK");
    expect(gapLabel(1, 0)).toBe("99.9% BACK");
  });

  it("narrates exactly the lead changes the curves contain", () => {
    const events = commentaryOf([A, B, C], 1n, 4);
    expect(events.map((e) => e.text)).toEqual([
      "THE GATES ARE OPEN · 3 RACERS IN THE BOOK",
      "CHOG #1 TAKES THE LEAD",
      "INTO THE STRETCH",
      "CHOG #1 WINS THE FLAG",
    ]);
    // the change line appears exactly when the winner's curve crosses over
    expect(events[1].at).toBe(0.9);
  });

  it("a wire-to-wire run gets its own line", () => {
    const front: LaneCurve = { tokenId: 7n, rank: 0, progressCurve: [0.4, 0.7, 0.95, 1.0] };
    const back: LaneCurve = { tokenId: 8n, rank: 1, progressCurve: [0.2, 0.4, 0.6, 0.7] };
    const texts = commentaryOf([front, back], 7n, 4).map((e) => e.text);
    expect(texts).toContain("CHOG #7 LEADS WIRE TO WIRE");
    expect(texts).toContain("CHOG #7 WINS THE FLAG");
  });

  it("commentary lines never appear out of order on screen", () => {
    for (const lanes of [[A, B, C], [B, A, C]]) {
      const events = commentaryOf(lanes, 1n, 4);
      const ats = events.map((e) => e.at);
      expect([...ats].sort((x, y) => x - y)).toEqual(ats);
    }
  });

  it("is deterministic: same replay, same commentary", () => {
    expect(commentaryOf([A, B, C], 1n, 4)).toEqual(commentaryOf([A, B, C], 1n, 4));
  });

  it("stamps the photo-finish margin from the two finish times", () => {
    const margin = marginOf([
      { tokenId: 1n, rank: 0, finishTime: 0.5 },
      { tokenId: 2n, rank: 1, finishTime: 0.508 },
    ]);
    expect(margin).toEqual({ winner: 1n, runnerUp: 2n, marginPct: 0.8 });
    expect(marginLabel(margin)).toBe("WON BY 0.8%");
  });

  it("the chain's rank decides who won, never the presentation times", () => {
    const margin = marginOf([
      { tokenId: 1n, rank: 0, finishTime: 0.7 },
      { tokenId: 2n, rank: 1, finishTime: 0.5 },
    ]);
    expect(margin?.winner).toBe(1n);
    expect(marginLabel(margin)).toBe("WON BY 0.0%");
  });

  it("a one-racer field has no margin to stamp", () => {
    expect(marginOf([{ tokenId: 1n, rank: 0, finishTime: 0.5 }])).toBeNull();
    expect(marginLabel(null)).toBe("");
  });

  it("lead-change lines carry the racer they are about", () => {
    const events = commentaryOf([A, B, C], 1n, 4);
    const change = events.find((e) => e.text.includes("TAKES THE LEAD"));
    expect(change?.tokenId).toBe(1n);
  });

  it("dust puffs land where the replay speeds run hot", () => {
    const stops = puffStops({ speeds: [1.2, 1.0, 1.1, 0.9], progressCurve: [0.3, 0.6, 0.85, 1.0] });
    expect(stops).toEqual([0, 0.6]);
    // a cold run gets no dust at all
    expect(puffStops({ speeds: [1, 1, 1], progressCurve: [0.3, 0.6, 1] })).toEqual([]);
  });
});
