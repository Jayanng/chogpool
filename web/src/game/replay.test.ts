import { describe, expect, it } from "vitest";
import { runStory } from "./replay";
import { buildRunRecord } from "./runRecord";
import { courseOf } from "./course";
import { coinsOf, initialRun, revive, step, type Input } from "./sim";

const SEED = "0xfeed";
const LEN = 40000;

function tape(n = 200): Input[] {
  return Array.from({ length: n }, (_, i) => ({
    jump: i % 37 === 5,
    jumpHeld: i % 37 >= 5 && i % 37 <= 12,
    duck: i % 41 === 20,
  }));
}

function stateOf(inputs: Input[], reviveAt: number | null) {
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

describe("the run's story: commentary and margin from the tape, not from us", () => {
  it("the story replays to the same numbers the record claims", () => {
    const inputs = tape();
    const state = stateOf(inputs, null);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt: null });
    const story = runStory(record);
    expect(story.score).toBe(record.claimed.score);
    expect(story.distance).toBe(record.claimed.distance);
    expect(story.coins).toBe(record.claimed.coins);
    expect(story.frames.length).toBeGreaterThan(0);
  });

  it("every event lands inside the run, never beyond it", () => {
    const inputs = tape();
    const state = stateOf(inputs, null);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt: null });
    const story = runStory(record);
    for (const e of story.events) {
      expect(e.at).toBeLessThanOrEqual(Math.max(story.distance, LEN) + 1);
      expect(e.text.length).toBeGreaterThan(0);
    }
  });

  it("a revived run's story says the revive was used", () => {
    const inputs = tape(260);
    const crashed = stateOf(inputs, null);
    const reviveAt = crashed.alive ? 0 : Math.floor(inputs.length * 0.6);
    const state = stateOf(inputs, reviveAt);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt });
    const story = runStory(record);
    expect(story.revived).toBe(true);
    if (!crashed.alive) {
      expect(story.events.some((e) => e.text.includes("revive is used"))).toBe(true);
    }
  });

  it("the margin is real arithmetic against the ghost", () => {
    const inputs = tape();
    const state = stateOf(inputs, null);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt: null });
    const ghostInputs = tape(120);
    const ghostState = stateOf(ghostInputs, null);
    const ghost = buildRunRecord({ seed: SEED, lengthPx: LEN, state: ghostState, inputs: ghostInputs, reviveAt: null });
    const story = runStory(record, ghost);
    expect(story.margin).toBe(record.claimed.score - ghost.claimed.score);
    expect(story.marginLabel).toBeTruthy();
  });

  it("with no ghost there is no margin, and nothing is invented", () => {
    const inputs = tape();
    const state = stateOf(inputs, null);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt: null });
    const story = runStory(record);
    expect(story.margin).toBeNull();
    expect(story.marginLabel).toBeNull();
  });

  it("the same record tells the same story twice", () => {
    const inputs = tape();
    const state = stateOf(inputs, null);
    const record = buildRunRecord({ seed: SEED, lengthPx: LEN, state, inputs, reviveAt: null });
    const a = runStory(record);
    const b = runStory(record);
    expect(a.events.map((e) => e.text)).toEqual(b.events.map((e) => e.text));
  });
});
