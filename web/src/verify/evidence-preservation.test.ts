// Evidence preservation for the verifier's step labels (web/src/verify/verifyDraw.ts).
//
// Two rules are pinned here. First, a rehearsal draw (one that exists only in
// its own record) must never wear chain evidence wording in the randomness
// step: the recorded value line and its mismatch text come from the draw's
// record voice. Second, a real draw's labels are evidence and stay byte for
// byte identical, so the rehearsal fix can never dumb down the live path.
//
// The reads are mocked at the transport (web/src/lib/wallet) and the race
// source (web/src/lib/game); the derivations under test are the real ones.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { commitHashOf, finalRandomnessOf } from "../lib/derive";
import { MAINNET } from "../generated/addresses.gen";
import type { Check } from "./verifyDraw";
import type { DrawRecord, RaceSource } from "../types/race";

const h = vi.hoisted(() => ({
  source: null as RaceSource | null,
  blockHash: "0x" as Hex,
  contractWinners: [] as bigint[],
}));

vi.mock("../lib/game", () => ({
  getRaceSource: () => h.source,
}));

vi.mock("../lib/chog", () => ({
  readChog: async () => null,
}));

vi.mock("../lib/wallet", () => ({
  testnetReadClient: {
    getBlock: async () => ({ hash: h.blockHash }),
    getLogs: async () => {
      throw new Error("eth_getLogs does not answer in this test");
    },
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      switch (functionName) {
        case "deriveWinners":
          return h.contractWinners;
        case "ticketsOf":
        case "ticketsOfFrozen":
          return 71186086n;
        case "badgeOf":
          return 1;
        case "isTestDrive":
          return true;
        case "tokenURI":
          return "test-chog:ipfs://bafytest/1462.json";
        case "mainnetOwnerOf":
          // Mock data from the address registry, never a literal in source.
          return MAINNET.chogToken;
        case "uriHashOf":
          throw new Error("this deployment records no URI digest");
        case "getCareer":
          return { gold: 1, silver: 0, bronze: 0, races: 1, wins: 1, fatigue: 0n };
        case "placementOf":
          return 1;
        default:
          throw new Error(`unexpected read in this test: ${functionName} ${JSON.stringify(args ?? [])}`);
      }
    },
  },
}));

const SEED: Hex = "0x147a012d4a7e433805ac5d04b5c1f19335d3c4dae4f2cf388b11c9b970acf703";
const REVEAL_BLOCK = 71255613n;
const TAMPERED: Hex = `0x${"11".repeat(32)}`;
const TOTAL_TICKETS = 71186086n;

function makeDraw(opts: { drawId: bigint; rehearsal: boolean; tampered: boolean }): DrawRecord {
  const finalRandomness = opts.tampered ? TAMPERED : finalRandomnessOf(SEED, h.blockHash, opts.drawId);
  return {
    drawId: opts.drawId,
    state: "finalized",
    closeAt: 1792068183,
    commitHash: commitHashOf(SEED),
    seed: SEED,
    finalRandomness,
    revealBlock: REVEAL_BLOCK,
    totalTickets: TOTAL_TICKETS,
    potPerWinner: 22941n,
    winners: [1462n],
    racers: [{ tokenId: 1462n, tickets: TOTAL_TICKETS, tier: 0, boost: 0n }],
    ...(opts.rehearsal
      ? {
          rehearsal: true,
          sourceNote: "Source: this test's own rehearsal record over a real seed.",
          recordedInscriptions: [],
          recordedCareers: {
            "1462": { gold: 1, silver: 0, bronze: 0, races: 1, wins: 1, fatigue: 0n, placementInRace: 1 },
          },
        }
      : {}),
  };
}

function sourceFor(kind: "live" | "fixture", draw: DrawRecord): RaceSource {
  return {
    kind,
    sentinel: "",
    currentDrawId: async () => draw.drawId,
    getDraw: async (drawId: bigint) => (drawId === draw.drawId ? draw : null),
  };
}

function checkLines(checks: Check[], key: string) {
  const check = checks.find((c) => c.key === key);
  expect(check, `the ${key} check must exist`).toBeDefined();
  return check!;
}

beforeEach(() => {
  // The real blockhash term for the reveal block below; any 32-byte value
  // works, but fixing it keeps every recomputation in this file deterministic.
  h.blockHash = "0x9d03c98bd5b4a77c6332e503cf1f9aa4cc1eb6e488dbb7d5e0d683315c1574d8";
  h.contractWinners = [1462n];
});

describe("a rehearsal draw's randomness step wears record wording only", () => {
  it("labels the recorded value from the draw's record, never 'on chain'", async () => {
    const draw = makeDraw({ drawId: 2n, rehearsal: true, tampered: false });
    h.source = sourceFor("fixture", draw);
    const { checks } = await (await import("./verifyDraw")).buildVerification(2n);
    const randomness = checkLines(checks, "randomness");
    expect(randomness.status).toBe("pass");
    expect(randomness.lines).toContain(`draw record    = ${draw.finalRandomness}`);
    // The whole step drops the on-chain voice: no line may claim a chain read.
    expect(randomness.lines.join("\n")).not.toContain("on chain");
    expect(randomness.lines.join("\n")).not.toContain("the chain's");
  });

  it("keeps the other evidence lines of the step byte for byte", async () => {
    const draw = makeDraw({ drawId: 2n, rehearsal: true, tampered: false });
    h.source = sourceFor("fixture", draw);
    const { checks } = await (await import("./verifyDraw")).buildVerification(2n);
    const randomness = checkLines(checks, "randomness");
    expect(randomness.lines).toEqual([
      `finalRandomness = keccak256(seed ++ blockhash(revealBlock) ++ uint256(drawId))`,
      `seed           = ${SEED}`,
      `blockhash(block ${REVEAL_BLOCK.toString()}) = ${h.blockHash}`,
      `drawId         = 2`,
      `recomputed     = ${finalRandomnessOf(SEED, h.blockHash, 2n)}`,
      `draw record    = ${draw.finalRandomness}`,
      "Exact match. The reveal block's hash is folded in, so the operator could not have chosen this randomness at commit time.",
    ]);
  });

  it("scopes the mismatch text to this draw's record", async () => {
    const draw = makeDraw({ drawId: 2n, rehearsal: true, tampered: true });
    h.source = sourceFor("fixture", draw);
    const { checks } = await (await import("./verifyDraw")).buildVerification(2n);
    const randomness = checkLines(checks, "randomness");
    expect(randomness.status).toBe("fail");
    expect(randomness.lines[randomness.lines.length - 1]).toBe(
      "MISMATCH: the recomputed randomness differs from this draw's record. Either the inputs shown here differ from what the record holds, or the record has been tampered with.",
    );
    expect(randomness.lines.join("\n")).not.toContain("the chain's");
  });

  it("keeps the verifier titles on the record wording", async () => {
    const draw = makeDraw({ drawId: 2n, rehearsal: true, tampered: false });
    h.source = sourceFor("fixture", draw);
    const { checks } = await (await import("./verifyDraw")).buildVerification(2n);
    expect(checkLines(checks, "record").title).toBe("What this draw's record holds");
    expect(checkLines(checks, "match").title).toBe("Recomputed vs this draw's record");
    expect(checkLines(checks, "randomness").title).toBe("The randomness binds the reveal block");
  });
});

describe("real draws keep their randomness evidence byte for byte", () => {
  it("prints the recorded randomness under the exact on-chain label", async () => {
    const draw = makeDraw({ drawId: 7n, rehearsal: false, tampered: false });
    h.source = sourceFor("live", draw);
    const { checks } = await (await import("./verifyDraw")).buildVerification(7n);
    const randomness = checkLines(checks, "randomness");
    expect(randomness.status).toBe("pass");
    expect(randomness.lines).toEqual([
      `finalRandomness = keccak256(seed ++ blockhash(revealBlock) ++ uint256(drawId))`,
      `seed           = ${SEED}`,
      `blockhash(block ${REVEAL_BLOCK.toString()}) = ${h.blockHash}`,
      `drawId         = 7`,
      `recomputed     = ${finalRandomnessOf(SEED, h.blockHash, 7n)}`,
      `on chain       = ${draw.finalRandomness}`,
      "Exact match. The reveal block's hash is folded in, so the operator could not have chosen this randomness at commit time.",
    ]);
    expect(checkLines(checks, "record").title).toBe("What the chain records for this race");
    expect(checkLines(checks, "match").title).toBe("Recomputed vs the on-chain record");
  });

  it("keeps the mismatch text naming the chain", async () => {
    const draw = makeDraw({ drawId: 7n, rehearsal: false, tampered: true });
    h.source = sourceFor("live", draw);
    const { checks } = await (await import("./verifyDraw")).buildVerification(7n);
    const randomness = checkLines(checks, "randomness");
    expect(randomness.status).toBe("fail");
    expect(randomness.lines[randomness.lines.length - 1]).toBe(
      "MISMATCH: the recomputed randomness differs from the chain's. Either the inputs shown here differ from what the contract used, or the record has been tampered with.",
    );
    expect(randomness.lines).toContain(`on chain       = ${draw.finalRandomness}`);
  });
});
