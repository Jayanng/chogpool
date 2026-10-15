// ABI parsing is runtime behavior: a malformed human-readable signature fails
// only when the module loads, which takes the whole site down with it. These
// smoke tests load every ABI this app parses so a bad signature can never
// reach a browser again.

import { describe, expect, it } from "vitest";
import { careerStoreAbi, drawEngineAbi, mirrorAbi, poolAbi, testChogAbi } from "./abi";

const NAMES: Array<readonly [readonly { name?: string }[], string]> = [
  [drawEngineAbi, "drawEngineAbi"],
  [poolAbi, "poolAbi"],
  [careerStoreAbi, "careerStoreAbi"],
  [mirrorAbi, "mirrorAbi"],
  [testChogAbi, "testChogAbi"],
];

describe("contract ABIs parse and carry the functions the pages call", () => {
  for (const [abi, name] of NAMES) {
    it(`${name} parses to real entries`, () => {
      expect(abi.length).toBeGreaterThan(0);
    });
  }

  it("the draw engine surface the verifier reads is complete", () => {
    for (const fn of [
      "stateOf",
      "commitOf",
      "seedOf",
      "finalRandomnessOf",
      "revealBlockOf",
      "winnersOf",
      "potPerWinnerOf",
      "totalTicketsOf",
      "ticketsOf",
      "drawCloseAt",
      "boostOf",
      "deriveWinners",
    ]) {
      expect(drawEngineAbi.some((e) => e.name === fn)).toBe(true);
    }
  });

  it("the CareerStore record round-trips its tuple shape", () => {
    const getCareer = careerStoreAbi.find((e) => e.name === "getCareer") as
      | { outputs?: Array<{ type: string; components?: Array<{ name: string }> }> }
      | undefined;
    const outputs = getCareer?.outputs ?? [];
    expect(outputs[0]?.type).toBe("tuple");
    expect((outputs[0]?.components ?? []).map((c) => c.name)).toEqual([
      "gold",
      "silver",
      "bronze",
      "races",
      "wins",
      "lastRaceAt",
      "fatigue",
    ]);
  });

  it("the pool withdraw-all entry matches IChogPool", () => {
    const withdrawAll = poolAbi.find((e) => e.name === "withdrawAll") as
      | { inputs: Array<{ name: string; type: string }>; outputs: unknown[] }
      | undefined;
    expect(withdrawAll?.inputs.map((i) => [i.name, i.type])).toEqual([["tokenId", "uint256"]]);
    expect(withdrawAll?.outputs).toEqual([]);
  });
});
