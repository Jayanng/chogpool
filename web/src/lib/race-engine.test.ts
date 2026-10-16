// Race engine determinism and invariants. The engine is the show's heart:
// these tests pin the promise that the same draw always plays back the same.

import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { buildRaceReplay, deriveFinishOrder, RACE_PARAMS, type RaceInput, type RaceLaneInput } from "./race-engine";

const SEED_A: Hex = "0xafb6d2d3faab8959a6dc32ef1d4eaa589d90bc8c6a736ddf967dcc3990c26c09";
const SEED_B: Hex = "0x3d2f0a91b7c4e5860a1db2c3f4e5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3";

function lane(tokenId: bigint, tickets: bigint, traits: Record<string, string>): RaceLaneInput {
  return { tokenId, tickets, boost: 0n, tier: "Common", traits };
}

function input(finalRandomness: Hex): RaceInput {
  return {
    drawId: 1n,
    finalRandomness,
    winners: [1462n],
    lanes: [
      lane(1462n, 52934966n, { Tier: "Uncommon", Eyes: "BTC Glass", Form: "Chog" }),
      lane(954n, 18251120n, { Tier: "Common", Eyes: "Green laser", Form: "Chog" }),
    ],
  };
}

describe("buildRaceReplay determinism", () => {
  it("produces identical frames for identical inputs, twice", () => {
    const a = buildRaceReplay(input(SEED_A));
    const b = buildRaceReplay(input(SEED_A));
    expect(a.frames(120)).toEqual(b.frames(120));
    expect(a.lanes.map((l) => [l.finishTime, l.paceBoost, l.style, l.shape])).toEqual(
      b.lanes.map((l) => [l.finishTime, l.paceBoost, l.style, l.shape]),
    );
  });

  it("produces different frames for a different seed", () => {
    const a = buildRaceReplay(input(SEED_A));
    const b = buildRaceReplay(input(SEED_B));
    expect(a.frames(120)).not.toEqual(b.frames(120));
  });

  it("keeps the on-chain winner first, whatever the seed says", () => {
    for (const seed of [SEED_A, SEED_B]) {
      const replay = buildRaceReplay(input(seed));
      expect(replay.winner).toBe(1462n);
      expect(replay.finishOrder[0]).toBe(1462n);
    }
  });

  it("orders finishing times strictly by rank with a photo finish at the front", () => {
    const replay = buildRaceReplay(input(SEED_A));
    const byRank = [...replay.lanes].sort((a, b) => a.rank - b.rank);
    expect(byRank[0].finishTime).toBeLessThan(byRank[1].finishTime);
    expect(byRank[1].finishTime - byRank[0].finishTime).toBeGreaterThanOrEqual(RACE_PARAMS.photoFinishGapMin - 1e-12);
    expect(byRank[1].finishTime - byRank[0].finishTime).toBeLessThanOrEqual(RACE_PARAMS.photoFinishGapMax + 1e-12);
  });
});

describe("progress curves", () => {
  it("is monotone, starts at 0 and reaches exactly 1 at each lane's finish", () => {
    const replay = buildRaceReplay(input(SEED_A));
    for (const lane of replay.lanes) {
      const values: number[] = [];
      for (let i = 0; i <= 200; i++) values.push(replay.progressAt(i / 200)[replay.lanes.indexOf(lane)]);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] - 1e-12);
      }
      expect(values[0]).toBeCloseTo(0, 12);
      const atFinish = replay.progressAt(lane.finishTime)[replay.lanes.indexOf(lane)];
      expect(atFinish).toBeCloseTo(1, 12);
      const afterFinish = replay.progressAt(Math.min(1, lane.finishTime + 0.01))[replay.lanes.indexOf(lane)];
      expect(afterFinish).toBe(1);
    }
  });

  it("returns one frame per requested count, one value per lane", () => {
    const replay = buildRaceReplay(input(SEED_A));
    const frames = replay.frames(37);
    expect(frames).toHaveLength(37);
    for (const frame of frames) expect(frame).toHaveLength(replay.lanes.length);
    expect(frames[36]).toEqual(replay.lanes.map(() => 1));
  });
});

describe("presentation cap", () => {
  it("never pushes pace beyond the +25% cap, perk or no perk", () => {
    const plain = buildRaceReplay(input(SEED_A));
    for (const lane of plain.lanes) {
      expect(Math.abs(lane.paceBoost)).toBeLessThanOrEqual(RACE_PARAMS.boostCap + 1e-12);
    }
    const drafted: RaceInput = {
      ...input(SEED_A),
      lanes: input(SEED_A).lanes.map((l) => ({
        ...l,
        boost: 250000000000000000n,
        perk: { id: "x", name: "X", paceDelta: 0.2 },
      })),
    };
    const boosted = buildRaceReplay(drafted);
    for (const lane of boosted.lanes) {
      expect(Math.abs(lane.paceBoost)).toBeLessThanOrEqual(RACE_PARAMS.boostCap + 1e-12);
    }
  });

  it("a drafted perk changes the look but never the winner", () => {
    const plain = buildRaceReplay(input(SEED_A));
    const drafted: RaceInput = {
      ...input(SEED_A),
      lanes: input(SEED_A).lanes.map((l, i) => ({
        ...l,
        perk: i === 1 ? { id: "late-kick", name: "Late Kick", paceDelta: 0.015 } : null,
      })),
    };
    const withPerk = buildRaceReplay(drafted);
    expect(withPerk.winner).toBe(plain.winner);
    expect(withPerk.finishOrder).toEqual(plain.finishOrder);
    // The look side of the claim: the drafted lane really runs differently.
    // Finish times are pinned to the chain's order; the perk moves the pace.
    expect(withPerk.lanes[1].paceBoost).not.toBe(plain.lanes[1].paceBoost);
    expect(withPerk.progressAt(0.5)[1]).not.toBe(plain.progressAt(0.5)[1]);
  });
});

function multiInput(finalRandomness: Hex): RaceInput {
  return {
    drawId: 1n,
    finalRandomness,
    winners: [1462n, 954n],
    lanes: [
      lane(1462n, 52934966n, { Tier: "Uncommon", Eyes: "BTC Glass", Form: "Chog" }),
      lane(954n, 18251120n, { Tier: "Common", Eyes: "Green laser", Form: "Chog" }),
      lane(7n, 1n, { Tier: "Common", Eyes: "Sleepy", Form: "Chog" }),
    ],
  };
}

describe("a multi-winner replay (winners [1462, 954])", () => {
  it("keeps both on-chain winners at the front, in payout order", () => {
    for (const seed of [SEED_A, SEED_B]) {
      const replay = buildRaceReplay(multiInput(seed));
      expect(replay.winner).toBe(1462n);
      expect(replay.finishOrder[0]).toBe(1462n);
      expect(replay.finishOrder[1]).toBe(954n);
      expect(replay.finishOrder).toHaveLength(3);
      expect(new Set(replay.finishOrder.map(String))).toEqual(new Set(["1462", "954", "7"]));
    }
  });

  it("replays identically every time", () => {
    const a = buildRaceReplay(multiInput(SEED_A));
    const b = buildRaceReplay(multiInput(SEED_A));
    expect(a.frames(60)).toEqual(b.frames(60));
    expect(a.lanes.map((l) => [l.finishTime, l.paceBoost])).toEqual(b.lanes.map((l) => [l.finishTime, l.paceBoost]));
  });
});

describe("deriveFinishOrder", () => {
  it("keeps the chain's winners at the head and covers every lane", () => {
    const order = deriveFinishOrder(SEED_A, [1462n], [1462n, 954n]);
    expect(order).toHaveLength(2);
    expect(order[0]).toBe(1462n);
    expect(new Set(order.map(String))).toEqual(new Set(["1462", "954"]));
  });
});
