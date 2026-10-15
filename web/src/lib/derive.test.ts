// The verifier's math, pinned against real Monad testnet data.
//
// These vectors are real: they come from Draw 1 on the deployed DrawEngine
// (seed 0x147a..., reveal block 71255613, frozen book 52,934,966 and
// 18,251,120 tickets, winner 1462). If any of these tests fail, the
// off-chain derivation has drifted from the contract and /verify is wrong.

import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import {
  commitHashOf,
  cumulativeWalk,
  deriveWinners,
  finalRandomnessOf,
  tokenAtCumulativeIndex,
} from "./derive";

const SEED: Hex = "0x147a012d4a7e433805ac5d04b5c1f19335d3c4dae4f2cf388b11c9b970acf703";
const REVEAL_BLOCK_HASH: Hex = "0x9d03c98bd5b4a77c6332e503cf1f9aa4cc1eb6e488dbb7d5e0d683315c1574d8";
const ON_CHAIN_COMMIT: Hex = "0x81fec32ffe3e8af0f2181dbc5d29761eba8849b05da20b34dd996d489e5c06a7";
const ON_CHAIN_FINAL_RANDOMNESS: Hex = "0xafb6d2d3faab8959a6dc32ef1d4eaa589d90bc8c6a736ddf967dcc3990c26c09";
const DRAW_ID = 1n;

const RACERS = [
  { tokenId: 1462n, tickets: 52934966n },
  { tokenId: 954n, tickets: 18251120n },
];
const TOTAL_TICKETS = 71186086n;

describe("draw 1 re-derivation (real chain vectors)", () => {
  it("the published seed hashes to the operator's commit", () => {
    expect(commitHashOf(SEED)).toBe(ON_CHAIN_COMMIT);
  });

  it("the seed and reveal block hash reproduce the chain's final randomness", () => {
    expect(finalRandomnessOf(SEED, REVEAL_BLOCK_HASH, DRAW_ID)).toBe(ON_CHAIN_FINAL_RANDOMNESS);
  });

  it("the exact contract formula reproduces the chain's winner", () => {
    const derived = deriveWinners(ON_CHAIN_FINAL_RANDOMNESS, RACERS, TOTAL_TICKETS, 1);
    expect(derived.winners.map(String)).toEqual(["1462"]);
    expect(derived.steps).toHaveLength(1);
    expect(derived.steps[0].walked).toBe(false);
  });
});

describe("the cumulative ticket walk", () => {
  it("skips zero-ticket racers and accumulates in list order", () => {
    const walk = cumulativeWalk([
      { tokenId: 1n, tickets: 10n },
      { tokenId: 2n, tickets: 0n },
      { tokenId: 3n, tickets: 5n },
    ]);
    expect(walk.map((r) => [r.tokenId, r.from, r.to])).toEqual([
      [1n, 0n, 10n],
      [3n, 10n, 15n],
    ]);
  });

  it("maps every index in range to exactly one racer", () => {
    for (const index of [0n, 1n, 52934965n, 52934966n, 71186085n]) {
      const picked = tokenAtCumulativeIndex(RACERS, index);
      expect([1462n, 954n]).toContain(picked);
      if (index < 52934966n) expect(picked).toBe(1462n);
      else expect(picked).toBe(954n);
    }
  });
});

describe("duplicate picks walk forward deterministically", () => {
  // A one-sided book makes a duplicate near-certain on the second slot, which
  // exercises the contract's forward-walk branch without hardcoding a seed.
  const lopsided = [
    { tokenId: 7n, tickets: 1000n },
    { tokenId: 8n, tickets: 1n },
  ];

  it("yields two distinct racers and marks the walked slot", () => {
    let sawWalk = false;
    for (let salt = 0; salt < 40 && !sawWalk; salt++) {
      const seed = finalRandomnessOf(SEED, REVEAL_BLOCK_HASH, BigInt(salt)) as Hex;
      const derived = deriveWinners(seed, lopsided, 1001n, 2);
      expect(new Set(derived.winners.map(String)).size).toBe(2);
      for (const tokenId of derived.winners) expect([7n, 8n]).toContain(tokenId);
      sawWalk = derived.steps.some((s) => s.walked);
    }
    expect(sawWalk).toBe(true);
  });
});
