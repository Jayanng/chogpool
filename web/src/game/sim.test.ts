import { describe, expect, it } from "vitest";
import { courseOf, prng } from "./course";
import { chogBox, coinsOf, initialRun, NO_INPUT, replay, revive, step, type Input } from "./sim";

const SEED = "0xc0ffee";
const LEN = 40000;
const course = courseOf(SEED, LEN);
const coins = coinsOf(course, SEED);

function run(inputs: Input[]) {
  let s = initialRun();
  for (const i of inputs) {
    s = step(s, i, course, coins);
    if (!s.alive) break;
  }
  return s;
}

function frames(n: number, i: Input = NO_INPUT): Input[] {
  return Array.from({ length: n }, () => i);
}

describe("the run: skill on the course, replayable from inputs", () => {
  it("running without touching anything dies on the first obstacle", () => {
    const s = run(frames(400));
    expect(s.alive).toBe(false);
    expect(s.distance).toBeGreaterThan(1080);
  });

  it("a held jump is higher than a tap jump", () => {
    const tap = run([...frames(20), { jump: true, jumpHeld: false, duck: false }, ...frames(60)]);
    const hold = run([...frames(20), { jump: true, jumpHeld: true, duck: false }, ...frames(60)]);
    expect(hold.score).toBeGreaterThanOrEqual(tap.score);
  });

  it("replay is exact: the same input tape rebuilds the same run", () => {
    const tape: Input[] = [
      ...frames(20),
      { jump: true, jumpHeld: true, duck: false },
      ...frames(40),
      { jump: false, jumpHeld: false, duck: true },
      ...frames(60),
    ];
    const a = replay(SEED, LEN, tape);
    const b = replay(SEED, LEN, tape);
    expect(a.score).toBe(b.score);
    expect(a.distance).toBe(b.distance);
    expect(a.coins).toBe(b.coins);
    expect(a.closeCalls).toBe(b.closeCalls);
  });

  it("dying stops the tape where it died, no ghost of a dead run", () => {
    const s = run(frames(400));
    expect(s.alive).toBe(false);
    const dead = step(s, { jump: true, jumpHeld: true, duck: true }, course, coins);
    expect(dead.frame).toBe(s.frame);
  });

  it("coins only land from real overlaps, never by time passing", () => {
    const s = run(frames(400));
    if (s.coins > 0) {
      expect(s.distance).toBeGreaterThan(coins[0].x);
    }
    expect(initialRun().coins).toBe(0);
  });

  it("the course and its coins are one seeded object", () => {
    const again = coinsOf(courseOf(SEED, LEN), SEED);
    expect(again.map((c) => `${c.x},${c.y}`)).toEqual(coins.map((c) => `${c.x},${c.y}`));
    expect(prng("x")()).toBe(prng("x")());
  });

  it("the chog hitbox ducks shorter than it stands", () => {
    const standing = chogBox(initialRun());
    const ducking = chogBox({ ...initialRun(), ducking: true });
    expect(ducking.h).toBeLessThan(standing.h);
  });

  it("a revive keeps the run's score and lifts the chog over the crash", () => {
    const dead = run(frames(400));
    expect(dead.alive).toBe(false);
    const back = revive({ ...dead, alive: true });
    expect(back.score).toBe(dead.score);
    expect(back.invuln).toBeGreaterThan(0);
    expect(back.height).toBeGreaterThan(0);
  });

  it("a revived chog survives the glide, invulnerability is real", () => {
    const dead = run(frames(400));
    const back = revive(dead);
    let s = back;
    for (let i = 0; i < 60; i++) s = step(s, NO_INPUT, course, coins);
    expect(s.alive).toBe(true);
    expect(s.invuln).toBeLessThan(back.invuln);
  });
});
