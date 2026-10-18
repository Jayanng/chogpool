import { describe, expect, it } from "vitest";
import { appearanceOf, boostRatioOf, MAX_BOOST } from "./chogArt";

const TRAITS = { Tier: "Rare", Body: "Violet", Eyes: "Keen" };

describe("chog art (presentation only, derived from real traits)", () => {
  it("is deterministic: same traits always draw the same Chog", () => {
    const a = appearanceOf({ tier: "Rare", traits: TRAITS, boost: 0n });
    const b = appearanceOf({ tier: "Rare", traits: TRAITS, boost: 0n });
    expect(a).toEqual(b);
  });

  it("does not depend on trait key order", () => {
    const a = appearanceOf({ tier: "Rare", traits: { Tier: "Rare", Body: "Violet", Eyes: "Keen" }, boost: 0n });
    const b = appearanceOf({ tier: "Rare", traits: { Eyes: "Keen", Tier: "Rare", Body: "Violet" }, boost: 0n });
    expect(a).toEqual(b);
  });

  it("different real traits draw different Chogs", () => {
    const a = appearanceOf({ tier: "Rare", traits: TRAITS, boost: 0n });
    const b = appearanceOf({ tier: "Common", traits: { Tier: "Common", Body: "Moss", Eyes: "Sleepy" }, boost: 0n });
    expect(a.hue === b.hue && a.marking === b.marking).toBe(false);
  });

  it("pins a known Chog to its exact appearance (art stays stable across refactors)", () => {
    const look = appearanceOf({ tier: "Rare", traits: TRAITS, boost: 0n });
    expect(look.hue).toBe(249);
    expect(look.marking).toBe("spots");
    expect(look.body).toBe("hsl(249 58% 62%)");
    expect(look.perk).toBe("none");
    expect(look.aura).toBe(false);
  });

  it("no boost, no aura", () => {
    const look = appearanceOf({ tier: "", traits: {}, boost: 0n });
    expect(look.aura).toBe(false);
    expect(look.auraStrength).toBe(0);
  });

  it("boost fills against the contract cap and never exceeds it", () => {
    expect(boostRatioOf(0n)).toBe(0);
    expect(boostRatioOf(125000000000000000n)).toBeCloseTo(0.5, 6);
    expect(boostRatioOf(250000000000000000n)).toBe(1);
    expect(boostRatioOf(500000000000000000n)).toBe(1);
    const look = appearanceOf({ tier: "", traits: {}, boost: 250000000000000000n });
    expect(look.aura).toBe(true);
    expect(look.auraStrength).toBe(1);
  });

  it("cap constant matches the contract's", () => {
    expect(MAX_BOOST).toBe(0.25);
  });

  it("no perk id, no cosmetic", () => {
    expect(appearanceOf({ tier: "", traits: {}, boost: 0n }).perk).toBe("none");
    expect(appearanceOf({ tier: "", traits: {}, boost: 0n, perkId: null }).perk).toBe("none");
  });

  it("a perk id always maps to some cosmetic or 'none', deterministically", () => {
    const a = appearanceOf({ tier: "", traits: {}, boost: 0n, perkId: "draft-night-rocket" });
    const b = appearanceOf({ tier: "", traits: {}, boost: 0n, perkId: "draft-night-rocket" });
    expect(a.perk).toBe(b.perk);
    expect(["none", "bandana", "goggles", "cape"]).toContain(a.perk);
  });
});
