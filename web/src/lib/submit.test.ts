import { describe, expect, it } from "vitest";
import { parseSubmission } from "./submit";

const goodRecord = {
  version: 1,
  seed: "abc",
  lengthPx: 6000,
  inputs: [{ jump: true, jumpHeld: true, duck: false }],
  reviveAt: null,
  claimed: { score: 10, distance: 6000, coins: 2, closeCalls: 0, cleared: true, revived: false },
};

describe("parseSubmission", () => {
  it("accepts a well-formed submission", () => {
    const parsed = parseSubmission({ tokenId: "20", record: goodRecord });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.tokenId).toBe(20n);
      expect(parsed.record.claimed.score).toBe(10);
    }
  });

  it("rejects a tokenId outside the roster", () => {
    expect(parseSubmission({ tokenId: "0", record: goodRecord }).ok).toBe(false);
    expect(parseSubmission({ tokenId: "1970", record: goodRecord }).ok).toBe(false);
    expect(parseSubmission({ record: goodRecord }).ok).toBe(false);
  });

  it("rejects records whose claimed numbers are not numbers", () => {
    const bad = { ...goodRecord, claimed: { ...goodRecord.claimed, score: "high" } };
    const parsed = parseSubmission({ tokenId: "20", record: bad });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("score");
  });

  it("rejects a missing or wrong record version", () => {
    expect(parseSubmission({ tokenId: "20", record: { ...goodRecord, version: 2 } }).ok).toBe(false);
    expect(parseSubmission({ tokenId: "20", record: {} }).ok).toBe(false);
    expect(parseSubmission({ tokenId: "20" }).ok).toBe(false);
    expect(parseSubmission(null).ok).toBe(false);
  });

  it("requires revived to be a boolean, never a truthy string", () => {
    const bad = { ...goodRecord, claimed: { ...goodRecord.claimed, revived: "yes" } };
    expect(parseSubmission({ tokenId: "20", record: bad }).ok).toBe(false);
  });
});
