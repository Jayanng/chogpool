// Share card text fitting. Real IPFS names can be any length, so every
// name-bearing label is measured against its own column and clipped to it:
// nothing may cross x 920 into the QR block (x 952..1148) or into the column
// beside it, at any winner count. The "and N more" fallback line gets the same
// treatment: it is re-measured with its own suffix and fits inside the column.

import { describe, expect, it } from "vitest";
import {
  COL1_MAX,
  COL2_MAX,
  fitLabel,
  WIDE_LABEL_MAX,
  wrapLabels,
} from "./ShareCard";

// A measuring context with fixed per-character widths. The real canvas metrics
// are close to these for the card's fonts: DM Mono runs near 0.6em per
// character, so 24px is about 14.4px a character and 18px about 10.8px.
function fakeCtx(charWidth: number): CanvasRenderingContext2D {
  return {
    measureText: (text: string) => ({ width: text.length * charWidth }),
  } as unknown as CanvasRenderingContext2D;
}

const THIRTY_CHAR_NAME = "SOME-THIRTY-CHARACTER-NAME-XYZ"; // exactly 30 chars

describe("name-bearing labels stay inside their column", () => {
  it("measures against a genuinely long name", () => {
    expect(THIRTY_CHAR_NAME.length).toBe(30);
    const ctx = fakeCtx(14.4);
    // The uncut label is the overflow the audit measured past x 920.
    const label = `CHOG #1462 · IPFS NAME: ${THIRTY_CHAR_NAME}`;
    expect(ctx.measureText(label).width).toBeGreaterThan(WIDE_LABEL_MAX);
  });

  it("leaves short labels untouched", () => {
    const ctx = fakeCtx(14.4);
    expect(fitLabel(ctx, "CHOG #1462", WIDE_LABEL_MAX)).toBe("CHOG #1462");
  });

  it("clips a 30-char name in the wide name column at N<=4", () => {
    const ctx = fakeCtx(14.4); // 24px DM Mono
    const label = `CHOG #1462 · IPFS NAME: ${THIRTY_CHAR_NAME}`;
    const fitted = fitLabel(ctx, label, WIDE_LABEL_MAX);
    expect(fitted.endsWith("…")).toBe(true);
    expect(fitted.startsWith("CHOG #1462")).toBe(true);
    expect(ctx.measureText(fitted).width).toBeLessThanOrEqual(WIDE_LABEL_MAX);
  });

  it("clips a 30-char name in both 18px columns at N=6 and N=10", () => {
    const ctx = fakeCtx(10.8); // 18px DM Mono
    for (const tokenId of ["1000", "1003"]) {
      const label = `CHOG #${tokenId} · ${THIRTY_CHAR_NAME}`;
      for (const [max, left, budget] of [
        [COL1_MAX, 348, 630],
        [COL2_MAX, 650, 920],
      ] as const) {
        const fitted = fitLabel(ctx, label, max);
        expect(ctx.measureText(fitted).width).toBeLessThanOrEqual(max);
        expect(left + ctx.measureText(fitted).width).toBeLessThanOrEqual(budget);
      }
    }
  });

  it("clips a 30-char name under the single winner's token id", () => {
    const ctx = fakeCtx(15.6); // 26px DM Mono
    const subLabel = `IPFS NAME: ${THIRTY_CHAR_NAME}`;
    const fitted = fitLabel(ctx, subLabel, WIDE_LABEL_MAX);
    expect(fitted.endsWith("…")).toBe(true);
    expect(ctx.measureText(fitted).width).toBeLessThanOrEqual(WIDE_LABEL_MAX);
  });

  it("still names the token when the name is cut", () => {
    const ctx = fakeCtx(14.4);
    const fitted = fitLabel(ctx, `CHOG #1462 · IPFS NAME: ${THIRTY_CHAR_NAME}`, WIDE_LABEL_MAX);
    expect(fitted).toContain("CHOG #1462");
  });
});

describe("the packed winner list counts the rest inside the column", () => {
  const units = Array.from({ length: 60 }, (_, i) => `CHOG #${1000 + i}`);

  function shownCount(lines: string[]): number {
    return lines.reduce((acc, line) => acc + (line.match(/#\d+/g)?.length ?? 0), 0);
  }

  it("keeps every line, count line included, measured inside the column", () => {
    const ctx = fakeCtx(10); // 10px DM Mono at 60 winners
    const lines = wrapLabels(ctx, units, WIDE_LABEL_MAX, 4);
    expect(lines.length).toBe(4);
    for (const line of lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(WIDE_LABEL_MAX);
    }
    const last = lines[lines.length - 1];
    expect(last).toContain("and ");
    expect(last).toContain(" more");
    // Every winner is either printed or counted, never dropped or double counted.
    const counted = Number(/and (\d+) more/.exec(last)?.[1] ?? "-1");
    expect(shownCount(lines) + counted).toBe(units.length);
  });

  it("makes room for the count suffix by dropping tail units", () => {
    const ctx = fakeCtx(10);
    // A column this tight fits 2 units a line; the suffix alone must push a
    // third unit off the last line instead of running past the column.
    const lines = wrapLabels(ctx, units, 250, 3);
    expect(lines.length).toBe(3);
    for (const line of lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(250);
    }
    expect(lines[2]).toContain("and 55 more");
    expect(shownCount(lines) + 55).toBe(units.length);
  });

  it("returns plain lines untouched when everything fits", () => {
    const ctx = fakeCtx(10);
    const lines = wrapLabels(ctx, ["CHOG #1", "CHOG #2"], WIDE_LABEL_MAX, 4);
    expect(lines).toEqual(["CHOG #1 · CHOG #2"]);
  });
});
