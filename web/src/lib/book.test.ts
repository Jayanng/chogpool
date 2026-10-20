import { describe, expect, it } from "vitest";
import { collectEntries } from "./book";

describe("the book (only the chain decides who is in it)", () => {
  it("a Chog enters the book only on a positive balance", () => {
    const entries = collectEntries([1n, 2n, 3n], [0n, 5n, null]);
    expect(entries).toEqual([{ tokenId: 2n, shares: 5n }]);
  });

  it("biggest stake first, ties break by Chog id", () => {
    const entries = collectEntries([1n, 2n, 3n], [5n, 9n, 5n]);
    expect(entries.map((e) => e.tokenId.toString())).toEqual(["2", "1", "3"]);
  });

  it("a failed call is skipped, never guessed at", () => {
    const entries = collectEntries([1n, 2n], [null, 7n]);
    expect(entries).toEqual([{ tokenId: 2n, shares: 7n }]);
  });

  it("an all-zero book is genuinely empty", () => {
    expect(collectEntries([1n, 2n], [0n, 0n])).toEqual([]);
    expect(collectEntries([], [])).toEqual([]);
  });

  it("is deterministic: same reads, same book", () => {
    const ids = [1n, 2n, 3n, 4n];
    const shares = [3n, 3n, 0n, 8n];
    expect(collectEntries(ids, shares)).toEqual(collectEntries(ids, shares));
  });
});
