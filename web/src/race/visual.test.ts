// The race show's presentation math. These helpers never touch the result;
// they only map values the draw already records onto the screen. The frames
// they produce are pinned here so the visual layer cannot drift them.

import { describe, expect, it } from "vitest";
import { countUpT, countUpValue, ordinalPlace, runnerLeft, trailWidth } from "./visual";

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
