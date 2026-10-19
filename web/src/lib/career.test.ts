import { describe, expect, it } from "vitest";
import { fatigueLevel, multiplierValue, placementLabel, readCareerProfile } from "./career";

describe("career display helpers", () => {
  it("labels the podium, marks any other finish as having run, and an unreadable placement unavailable", () => {
    expect(placementLabel(1)).toBe("1st");
    expect(placementLabel(2)).toBe("2nd");
    expect(placementLabel(3)).toBe("3rd");
    expect(placementLabel(0)).toBe("Ran");
    expect(placementLabel(7)).toBe("Ran");
    expect(placementLabel(null)).toBe("Unavailable");
  });

  it("rejects an id outside 1-1,969 instead of returning a fake empty career", async () => {
    await expect(readCareerProfile(0n)).rejects.toThrow(/outside the 1-1969 range/);
    await expect(readCareerProfile(10n ** 18n)).rejects.toThrow(/outside the 1-1969 range/);
  });

  it("reads fatigue as a 0-1 level from a 1e18 fixed point", () => {
    expect(fatigueLevel(0n)).toBe(0);
    expect(fatigueLevel(10n ** 18n)).toBe(1);
    expect(fatigueLevel(5n * 10n ** 17n)).toBe(0.5);
  });

  it("reads the odds multiplier as a fraction with 1e18 neutral", () => {
    expect(multiplierValue(10n ** 18n)).toBe(1);
    expect(multiplierValue(85n * 10n ** 16n)).toBe(0.85);
  });
});
