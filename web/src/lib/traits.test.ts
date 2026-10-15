// Draft Night offers are deterministic in (draw, racer, real traits) and stay
// inside the presentation cap. The perk catalog only weaves values that really
// exist in the Chog's IPFS metadata; nothing here invents a stat.

import { describe, expect, it } from "vitest";
import { perkOffers, traitsOf, tierOf } from "./traits";

const TRAITS = {
  Background: "Deep Aqua",
  Base: "Origin",
  Skin: "Pink",
  Side: "Left",
  Body: "Yellow 143 Jersey",
  Mouth: "Flat",
  Eyes: "BTC Glass",
  Head: "MCGA",
  Accessory: "Fwog",
  Form: "Chog",
  Tier: "Uncommon",
  Naked: "No",
};

describe("perkOffers", () => {
  it("deals the same three offers for the same draw, racer and traits", () => {
    const a = perkOffers(1n, 1462n, TRAITS);
    const b = perkOffers(1n, 1462n, TRAITS);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((p) => p.id)).size).toBe(3);
  });

  it("deals different offers for a different racer", () => {
    const a = perkOffers(1n, 1462n, TRAITS);
    const b = perkOffers(1n, 954n, TRAITS);
    expect(a.map((p) => p.id)).not.toEqual(b.map((p) => p.id));
  });

  it("keeps every pace delta inside the +25% presentation cap", () => {
    for (const perk of perkOffers(1n, 1462n, TRAITS)) {
      expect(Math.abs(perk.paceDelta)).toBeLessThanOrEqual(0.25);
      expect(perk.blurb.length).toBeGreaterThan(10);
    }
  });

  it("works from real metadata attributes", () => {
    const traits = traitsOf({
      name: "CHOG #1462",
      attributes: [
        { trait_type: "Eyes", value: "BTC Glass" },
        { trait_type: "Tier", value: "Uncommon" },
      ],
    });
    expect(traits.Eyes).toBe("BTC Glass");
    expect(tierOf(traits)).toBe("Uncommon");
    expect(perkOffers(1n, 1462n, traits)).toHaveLength(3);
  });
});
