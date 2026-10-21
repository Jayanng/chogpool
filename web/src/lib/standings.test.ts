import { describe, expect, it } from "vitest";
import { rankRuns, standingsNote, type StandingRow, type WeekStandings } from "./standings";

const row = (tokenId: number, score: number, coins = 0, revived = false): StandingRow => ({
  tokenId: BigInt(tokenId),
  score: BigInt(score),
  coins: BigInt(coins),
  revived,
});

describe("rankRuns", () => {
  it("ranks by score, highest first", () => {
    const ranked = rankRuns([row(20, 100), row(7, 500), row(3, 250)]);
    expect(ranked.map((r) => r.tokenId)).toEqual([7n, 3n, 20n]);
  });

  it("breaks score ties by tokenId so the order never wobbles", () => {
    const ranked = rankRuns([row(9, 100), row(2, 100), row(5, 100)]);
    expect(ranked.map((r) => r.tokenId)).toEqual([2n, 5n, 9n]);
  });

  it("does not mutate the input", () => {
    const input = [row(2, 1), row(1, 2)];
    rankRuns(input);
    expect(input.map((r) => r.tokenId)).toEqual([2n, 1n]);
  });
});

describe("standingsNote", () => {
  const base: WeekStandings = { rows: [], recorded: 0, covered: true };

  it("says so plainly when the week has no runs", () => {
    expect(standingsNote(base)).toContain("No runs recorded");
  });

  it("claims completeness only when the scan reached the opening", () => {
    expect(standingsNote({ ...base, recorded: 3, rows: [row(1, 1)], covered: true })).toContain(
      "All 3 recorded runs",
    );
    expect(standingsNote({ ...base, recorded: 3, rows: [row(1, 1)], covered: false })).toContain(
      "1 of 3",
    );
    expect(standingsNote({ ...base, recorded: 3, rows: [row(1, 1)], covered: false })).not.toContain(
      "All 3",
    );
  });

  it("uses singular wording for one run", () => {
    expect(standingsNote({ ...base, recorded: 1, rows: [row(1, 1)], covered: true })).toContain(
      "All 1 recorded run,",
    );
  });
});
