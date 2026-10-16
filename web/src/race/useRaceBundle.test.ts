// The three-state read mapping behind every racer lane (F4's rule): a read
// that did not answer is never an answer about the chain. The tests drive the
// real loadRacer against a dead RPC (a port with nothing listening, so the
// reads genuinely fail) and against canned answers, and pin all three states.

import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { DEPLOYED, MAINNET } from "../generated/addresses.gen";
import type { DrawRecord } from "../types/race";

const h = vi.hoisted(() => ({
  /** When true every read is sent at a dead endpoint and cannot answer. */
  dead: false,
  teamAnswer: "0x" as string,
  badgeAnswer: 0,
}));

vi.mock("../lib/game", () => ({ getRaceSource: () => null }));

vi.mock("../lib/chog", () => ({
  readChog: async () => null,
  ipfsToGateway: (uri: string) => uri,
}));

vi.mock("../lib/wallet", () => ({
  testnetReadClient: {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (h.dead) {
        // The dead-RPC path: a real request at a port with nothing on it, so
        // the rejection below is a genuine transport failure.
        await fetch("http://127.0.0.1:9/", { method: "POST", body: "{}" });
        throw new Error("the dead RPC answered, which it must not");
      }
      switch (functionName) {
        case "depositOf":
          return [h.teamAnswer, 0n, 0n];
        case "badgeOf":
          return h.badgeAnswer;
        case "isTestDrive":
          return h.badgeAnswer === 1;
        case "tokenURI":
          return "test-chog:ipfs://bafytest/1462.json";
        case "mainnetOwnerOf":
          return MAINNET.chogToken;
        case "uriHashOf":
          throw new Error("this deployment records no URI digest");
        default:
          throw new Error(`unexpected read in this test: ${functionName}`);
      }
    },
  },
}));

const { loadRacer } = await import("./useRaceBundle");

// Constructed, never a literal: infra/check-addresses.mjs keeps 40-hex
// literals out of source, and this test only needs "the zero address".
const ZERO_ADDRESS = `0x${"0".repeat(40)}` as Address;
const TEAM = DEPLOYED.pool as Address;

const draw: DrawRecord = {
  drawId: 1n,
  state: "finalized",
  closeAt: 0,
  commitHash: "0x",
  seed: "0x",
  finalRandomness: "0x",
  revealBlock: 0n,
  totalTickets: 1n,
  potPerWinner: 0n,
  winners: [],
  racers: [{ tokenId: 1462n, tickets: 1n, tier: 0, boost: 0n }],
  recordedCareers: {
    "1462": { gold: 0, silver: 0, bronze: 0, races: 0, wins: 0, fatigue: 0n, placementInRace: 0 },
  },
};

describe("a racer's team and badge reads keep three states", () => {
  it("reports failed (not absent) when the reads cannot answer at all", async () => {
    h.dead = true;
    const racer = await loadRacer(1462n, draw);
    h.dead = false;
    expect(racer.team).toEqual({ state: "failed" });
    expect(racer.badge).toEqual({ state: "failed" });
  });

  it("claims absence only when the chain answered with nothing", async () => {
    h.teamAnswer = ZERO_ADDRESS;
    h.badgeAnswer = 0;
    const racer = await loadRacer(1462n, draw);
    expect(racer.team).toEqual({ state: "absent" });
    expect(racer.badge).toEqual({ state: "absent" });
  });

  it("keeps the values when the reads answer with them", async () => {
    h.teamAnswer = TEAM;
    h.badgeAnswer = 1;
    const racer = await loadRacer(1462n, draw);
    expect(racer.team).toEqual({ state: "value", value: TEAM });
    expect(racer.badge.state).toBe("value");
    if (racer.badge.state === "value") {
      expect(racer.badge.value.badge).toBe(1);
      expect(racer.badge.value.badgeLabel).toBe("Test Drive");
    }
  });
});
