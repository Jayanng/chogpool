import { describe, expect, it } from "vitest";
import { roundHeadline, stateName, type RoundView } from "./rounds";

describe("stateName", () => {
  it("maps the contract's RoundState order exactly", () => {
    expect(stateName(0)).toBe("none");
    expect(stateName(1)).toBe("open");
    expect(stateName(2)).toBe("closed");
    expect(stateName(3)).toBe("settled");
  });

  it("refuses a value outside the enum instead of guessing a state", () => {
    expect(stateName(4)).toBeNull();
    expect(stateName(-1)).toBeNull();
  });
});

describe("roundHeadline", () => {
  it("says no round was opened when the chain has none", () => {
    const h = roundHeadline(null);
    expect(h.title).toBe("No round opened yet");
    expect(h.note).toContain("deployed and live on chain");
  });

  it("names the round in every live state", () => {
    const base = { id: 7n, closesAt: 0n, participants: 3 };
    const open: RoundView = { ...base, state: "open" };
    const closed: RoundView = { ...base, state: "closed" };
    const settled: RoundView = { ...base, state: "settled" };
    expect(roundHeadline(open).title).toBe("Round 7 is open");
    expect(roundHeadline(closed).title).toBe("Round 7 is locked");
    expect(roundHeadline(settled).title).toBe("Round 7 is settled");
  });

  it("never promises payment before settlement", () => {
    const closed: RoundView = { id: 1n, state: "closed", closesAt: 0n, participants: 0 };
    const open: RoundView = { id: 1n, state: "open", closesAt: 0n, participants: 0 };
    // Closed says payment is coming at settlement; open does not mention pay.
    expect(roundHeadline(closed).note).toContain("Settlement pays");
    expect(roundHeadline(open).note.toLowerCase()).not.toContain("paid");
    // Settled is the only state allowed to say winners were paid.
    const settled: RoundView = { id: 1n, state: "settled", closesAt: 0n, participants: 0 };
    expect(roundHeadline(settled).note).toContain("paid on chain");
    expect(roundHeadline(open).note).not.toContain("paid on chain");
    expect(roundHeadline(closed).note).not.toContain("paid on chain");
  });
});
