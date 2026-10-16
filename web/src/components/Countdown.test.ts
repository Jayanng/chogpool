// The lapsed-window note. A commit window that has passed must say WHEN it
// passed, and it must only promise the field will lock on close while the draw
// is still open: a closed or awarded draw already locked its field.

import { describe, expect, it } from "vitest";
import { windowEndedNote } from "./Countdown";

const CLOSE_AT = 1792068183;

describe("the lapsed commit window says when it ended and what it means", () => {
  it("keeps the lock-on-close promise only for a still-open draw", () => {
    const note = windowEndedNote(false, CLOSE_AT);
    expect(note).toContain("The field locks when the operator closes the draw on chain.");
    expect(note).toContain("(unix 1792068183)");
    expect(note).toContain("The commit window ended");
  });

  it("says the field already locked for a closed or awarded draw", () => {
    const note = windowEndedNote(true, CLOSE_AT);
    expect(note).toContain("The field is already locked");
    expect(note).not.toContain("The field locks when the operator closes");
    expect(note).toContain("(unix 1792068183)");
  });

  it("claims neither when the draw's state could not be read", () => {
    const note = windowEndedNote(null, CLOSE_AT);
    expect(note).toContain("could not be read");
    expect(note).not.toContain("The field locks when");
    expect(note).not.toContain("already locked");
  });

  it("always names the end time, never just that it ended", () => {
    for (const state of [true, false, null]) {
      expect(windowEndedNote(state, CLOSE_AT)).toMatch(/\(unix 1792068183\)/);
    }
  });
});
