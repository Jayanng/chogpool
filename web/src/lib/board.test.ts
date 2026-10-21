import { describe, expect, it } from "vitest";
import { podiumOf } from "./board";

describe("the leaderboard: only recorded placements appear", () => {
  it("the recorded 1st, 2nd and 3rd become the podium, in order", () => {
    const rows = podiumOf([
      { tokenId: 7n, placement: 2 },
      { tokenId: 3n, placement: 1 },
      { tokenId: 9n, placement: 3 },
    ]);
    expect(rows.map((r) => [String(r.place), r.tokenId.toString()])).toEqual([
      ["1", "3"],
      ["2", "7"],
      ["3", "9"],
    ]);
  });

  it("a placement the store never recorded is simply not on the board", () => {
    const rows = podiumOf([
      { tokenId: 3n, placement: 1 },
      { tokenId: 7n, placement: 0 },
      { tokenId: 9n, placement: null },
    ]);
    expect(rows).toEqual([{ place: 1, tokenId: 3n }]);
  });

  it("no row is invented when nothing is recorded", () => {
    expect(podiumOf([])).toEqual([]);
    expect(podiumOf([{ tokenId: 1n, placement: 0 }])).toEqual([]);
  });

  it("the board is deterministic: same records, same board", () => {
    const entries = [
      { tokenId: 5n, placement: 3 },
      { tokenId: 1n, placement: 1 },
      { tokenId: 2n, placement: 2 },
    ];
    expect(podiumOf(entries)).toEqual(podiumOf(entries));
  });
});
