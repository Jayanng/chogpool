// Three states per read: value present, genuinely absent on chain, or the
// read did not answer. The mapping must keep the third state distinct: a
// failed read rendered as "nothing there" is a false claim about the chain.

import { describe, expect, it } from "vitest";
import { readOutcome, type ReadOutcome } from "./read-outcome";

const fulfilled = <T>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
const rejected = <T>(): PromiseSettledResult<T> => ({ status: "rejected", reason: new Error("HTTP 429") });

// Abstract stand-ins: this is the pure mapping, so the value shapes stay
// deliberately boring (the zero-address and badge-0 rules live with the reads
// that produce them, in web/src/race/useRaceBundle.ts).
const isBlank = (s: string) => s === "";
const isNoBadge = (b: number) => b === 0;

describe("one settled read maps to exactly one of three states", () => {
  it("keeps the value when the read answers with one", () => {
    const team = readOutcome<string>(fulfilled("TEAM_WALLET_ADDRESS"), isBlank);
    expect(team).toEqual({ state: "value", value: "TEAM_WALLET_ADDRESS" });
    const badge = readOutcome<number>(fulfilled(1), isNoBadge);
    expect(badge).toEqual({ state: "value", value: 1 });
  });

  it("reports a genuine absence only when the read itself confirms it", () => {
    const team = readOutcome<string>(fulfilled(""), isBlank);
    expect(team).toEqual({ state: "absent" });
    const badge = readOutcome<number>(fulfilled(0), isNoBadge);
    expect(badge).toEqual({ state: "absent" });
  });

  it("reports a rejected read as failed, never as absent", () => {
    const team: ReadOutcome<string> = readOutcome<string>(rejected<string>(), isBlank);
    expect(team).toEqual({ state: "failed" });
    const badge: ReadOutcome<number> = readOutcome<number>(rejected<number>(), isNoBadge);
    expect(badge).toEqual({ state: "failed" });
  });

  it("never claims a value it does not hold", () => {
    const outcomes: ReadOutcome<string>[] = [
      readOutcome<string>(fulfilled(""), isBlank),
      readOutcome<string>(rejected<string>(), isBlank),
    ];
    for (const outcome of outcomes) {
      expect(outcome.state === "value" ? outcome.value : null).toBeNull();
    }
  });
});
