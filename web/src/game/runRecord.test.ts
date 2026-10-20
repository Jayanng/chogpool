import { describe, expect, it } from "vitest";
import { buildRunRecord, parseRunRecord, verifyRunRecord } from "./runRecord";
import { courseOf } from "./course";
import { coinsOf, initialRun, revive, step, type Input } from "./sim";

const SEED = "0xcafe";
const LEN = 40000;

function makeTape(): Input[] {
  return [
    ...Array.from({ length: 30 }, () => ({ jump: false, jumpHeld: false, duck: false })),
    { jump: true, jumpHeld: true, duck: false },
    ...Array.from({ length: 40 }, () => ({ jump: false, jumpHeld: true, duck: false })),
    ...Array.from({ length: 50 }, () => ({ jump: false, jumpHeld: false, duck: true })),
    ...Array.from({ length: 200 }, () => ({ jump: false, jumpHeld: false, duck: false })),
  ];
}

function runTo(inputs: Input[], reviveAt: number | null) {
  const course = courseOf(SEED, LEN);
  const coins = coinsOf(course, SEED);
  let s = initialRun();
  for (let i = 0; i < inputs.length; i++) {
    if (reviveAt !== null && i === reviveAt) s = revive(s);
    s = step(s, inputs[i], course, coins);
    if (!s.alive) break;
  }
  return s;
}

describe("the run record: anyone re-runs a run and checks its numbers", () => {
  it("an honest record passes every check", () => {
    const inputs = makeTape();
    const state = runTo(inputs, null);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt: null });
    const v = verifyRunRecord(record);
    expect(v.ok).toBe(true);
    expect(v.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("a tampered score is caught by recomputation", () => {
    const inputs = makeTape();
    const state = runTo(inputs, null);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt: null });
    const lie = { ...record, claimed: { ...record.claimed, score: record.claimed.score + 500 } };
    const v = verifyRunRecord(lie);
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.label === "Score recomputes")?.ok).toBe(false);
  });

  it("a tampered seed is caught: the numbers stop recomputing", () => {
    const inputs = makeTape();
    const state = runTo(inputs, null);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt: null });
    const lie = { ...record, seed: "0xdead" };
    expect(verifyRunRecord(lie).ok).toBe(false);
  });

  it("a claimed revive without a revive marker fails", () => {
    const inputs = makeTape();
    const state = runTo(inputs, null);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt: null });
    const lie = { ...record, claimed: { ...record.claimed, revived: true } };
    const v = verifyRunRecord(lie);
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.label === "Revive flag consistent")?.ok).toBe(false);
  });

  it("a revived run verifies with its revive marker", () => {
    const inputs = makeTape();
    const crashed = runTo(inputs, null);
    expect(crashed.alive).toBe(false);
    const reviveAt = inputs.length - 30;
    const state = runTo(inputs, reviveAt);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt });
    const v = verifyRunRecord(record);
    expect(v.checks.find((c) => c.label === "Revive flag consistent")?.ok).toBe(true);
    expect(v.ok).toBe(true);
  });

  it("parsing is strict and says what is wrong", () => {
    expect(parseRunRecord("not json").error).toMatch(/not JSON/);
    expect(parseRunRecord("{}").error).toMatch(/version/);
    const inputs = makeTape();
    const state = runTo(inputs, null);
    const good = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt: null });
    const parsed = parseRunRecord(JSON.stringify(good));
    expect(parsed.error).toBeNull();
    expect(parsed.record?.claimed.score).toBe(good.claimed.score);
    const badTape = { ...good, inputs: [{ jump: 1, jumpHeld: false, duck: false }] };
    expect(parseRunRecord(JSON.stringify(badTape)).error).toMatch(/malformed/);
  });

  it("record building never invents numbers: claimed equals the sim's", () => {
    const inputs = makeTape();
    const state = runTo(inputs, null);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt: null });
    expect(record.claimed.score).toBe(state.score);
    expect(record.claimed.distance).toBe(state.distance);
    expect(record.claimed.cleared).toBe(state.distance >= LEN);
  });
});
