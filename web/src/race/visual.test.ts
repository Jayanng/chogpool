// The race show's presentation math. These helpers never touch the result;
// they only map values the draw already records onto the screen. The frames
// they produce are pinned here so the visual layer cannot drift them.

import { describe, expect, it } from "vitest";
import {
  confettiDepthAlpha,
  confettiDepthSize,
  confettiDepthSpeed,
  confettiField,
  countUpT,
  countUpValue,
  ordinalPlace,
  runnerLeft,
  seededRandom,
  trailWidth,
} from "./visual";

describe("runnerLeft", () => {
  it("keeps the runner inside the track and breaks the line at 1", () => {
    expect(runnerLeft(0, 96)).toBe("calc((100% - var(--runner-w, 96px) - 22px) * 0.0000)");
    expect(runnerLeft(1, 96)).toBe("calc((100% - var(--runner-w, 96px) - 22px) * 1.0000)");
  });

  it("clamps strays instead of flying off the track", () => {
    expect(runnerLeft(-0.2, 64)).toBe("calc((100% - var(--runner-w, 64px) - 22px) * 0.0000)");
    expect(runnerLeft(1.7, 64)).toBe("calc((100% - var(--runner-w, 64px) - 22px) * 1.0000)");
    expect(runnerLeft(Number.NaN, 64)).toBe("calc((100% - var(--runner-w, 64px) - 22px) * 0.0000)");
  });
});

describe("trailWidth", () => {
  it("travels the same distance as the runner", () => {
    expect(trailWidth(0)).toBe("calc((100% - 22px) * 0.0000)");
    expect(trailWidth(0.5)).toBe("calc((100% - 22px) * 0.5000)");
    expect(trailWidth(1)).toBe("calc((100% - 22px) * 1.0000)");
  });
});

describe("countUpValue", () => {
  it("lands exactly on the real number", () => {
    expect(countUpValue(0n, 11470n, 1)).toBe(11470n);
    expect(countUpValue(0n, 11470n, 1.4)).toBe(11470n);
  });

  it("starts at the floor and never overshoots the target", () => {
    expect(countUpValue(0n, 11470n, 0)).toBe(0n);
    const mid = countUpValue(0n, 11470n, 0.5);
    expect(mid).toBeGreaterThanOrEqual(0n);
    expect(mid).toBeLessThanOrEqual(11470n);
    expect(mid).toBe(5735n);
  });

  it("counts between any two recorded values", () => {
    expect(countUpValue(100n, 200n, 0.25)).toBe(125n);
  });
});

describe("countUpT", () => {
  it("is a plain 0..1 clock", () => {
    expect(countUpT(0, 900)).toBe(0);
    expect(countUpT(450, 900)).toBe(0.5);
    expect(countUpT(900, 900)).toBe(1);
    expect(countUpT(5000, 900)).toBe(1);
    expect(countUpT(10, 0)).toBe(1);
    expect(countUpT(-5, 900)).toBe(0);
  });
});

describe("ordinalPlace", () => {
  it("reads 1ST, 2ND, 3RD and the teens as TH", () => {
    expect(ordinalPlace(1)).toBe("1ST");
    expect(ordinalPlace(2)).toBe("2ND");
    expect(ordinalPlace(3)).toBe("3RD");
    expect(ordinalPlace(4)).toBe("4TH");
    expect(ordinalPlace(11)).toBe("11TH");
    expect(ordinalPlace(12)).toBe("12TH");
    expect(ordinalPlace(13)).toBe("13TH");
    expect(ordinalPlace(21)).toBe("21ST");
    expect(ordinalPlace(0)).toBe("1ST");
    expect(ordinalPlace(-4)).toBe("1ST");
  });
});

/* The confetti scatter is pure draw-seeded layout: pinned here so the burst
   cannot quietly turn back into wallpaper. */

const SEED_A = `0x${"ab".repeat(32)}`;
const SEED_B = `0x${"cd".repeat(32)}`;

describe("seededRandom", () => {
  it("replays the same stream for the same seed and salt", () => {
    const a = seededRandom(SEED_A, 7);
    const b = seededRandom(SEED_A, 7);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it("scatters differently under a different seed or salt", () => {
    const sameSalt = seededRandom(SEED_B, 7);
    const otherSalt = seededRandom(SEED_A, 8);
    const base = seededRandom(SEED_A, 7);
    const draws = [base(), base(), base()];
    expect([sameSalt(), sameSalt(), sameSalt()]).not.toEqual(draws);
    expect([otherSalt(), otherSalt(), otherSalt()]).not.toEqual(draws);
  });
});

describe("confettiField", () => {
  it("lays out the same field from the same seed", () => {
    const one = confettiField(seededRandom(SEED_A, 0), 1200, 600, 120, "fall");
    const two = confettiField(seededRandom(SEED_A, 0), 1200, 600, 120, "fall");
    expect(one).toEqual(two);
  });

  it("packs the field at the top and thins it downward", () => {
    const field = confettiField(seededRandom(SEED_A, 0), 1200, 600, 400, "fall");
    const meanY = field.reduce((acc, p) => acc + p.y, 0) / field.length;
    const topHalf = field.filter((p) => p.y < 300).length;
    expect(meanY).toBeLessThan(600 * 0.5);
    expect(topHalf).toBeGreaterThan(field.length * 0.5);
  });

  it("layers near and far pieces with varied sizes and fall speeds", () => {
    const field = confettiField(seededRandom(SEED_A, 0), 1200, 600, 300, "fall");
    const sizes = new Set(field.map((p) => Math.round(p.size)));
    const speeds = new Set(field.map((p) => p.vy));
    const depths = new Set(field.map((p) => p.depth));
    expect(Math.min(...sizes)).toBeLessThan(7);
    expect(Math.max(...sizes)).toBeGreaterThan(12);
    expect(speeds.size).toBeGreaterThan(10);
    expect([...depths].sort()).toEqual([0, 1, 2]);
  });

  it("gives every piece a mount kick that flies outward from the top", () => {
    const field = confettiField(seededRandom(SEED_A, 0), 1200, 600, 200, "fall");
    expect(field.every((p) => p.kickY < 0)).toBe(true);
    const left = field.find((p) => p.x < 600);
    const right = field.find((p) => p.x >= 600);
    if (left) expect(left.kickX).toBeLessThanOrEqual(0);
    if (right) expect(right.kickX).toBeGreaterThanOrEqual(0);
  });

  it("explodes the finish burst from the crossing point", () => {
    const field = confettiField(seededRandom(SEED_A, 0), 1200, 600, 80, "burst");
    expect(field).toHaveLength(80);
    expect(field.every((p) => p.x === 1200 * 0.9 && p.y === 600 * 0.5)).toBe(true);
    expect(field.every((p) => p.kickX === 0 && p.kickY === 0)).toBe(true);
  });
});

describe("confetti depth layers", () => {
  it("makes far pieces small, slow and dim, near pieces big, fast and full", () => {
    expect(confettiDepthSize(0)).toBeLessThan(confettiDepthSize(2));
    expect(confettiDepthSpeed(0)).toBeLessThan(confettiDepthSpeed(2));
    expect(confettiDepthAlpha(0)).toBeLessThan(confettiDepthAlpha(2));
    expect(confettiDepthSize(9)).toBe(1);
    expect(confettiDepthSpeed(9)).toBe(1);
    expect(confettiDepthAlpha(9)).toBe(1);
  });
});
