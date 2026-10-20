import { describe, expect, it } from "vitest";
import { courseIsFair, courseOf, prng } from "./course";
import { jumpPeak, overlaps, speedAt, PHYSICS } from "./physics";

describe("the course: one seed, one field, for everyone", () => {
  it("the same seed builds the exact same course", () => {
    const a = courseOf("0xdeadbeef", 20000);
    const b = courseOf("0xdeadbeef", 20000);
    expect(a.length).toBe(b.length);
    expect(a.map((o) => `${o.kind.id}@${o.x}`)).toEqual(b.map((o) => `${o.kind.id}@${o.x}`));
  });

  it("a different seed builds a different course", () => {
    const a = courseOf("0xdeadbeef", 20000).map((o) => o.x).join(",");
    const b = courseOf("0xfeedface", 20000).map((o) => o.x).join(",");
    expect(a).not.toEqual(b);
  });

  it("the first three seconds of track are clear", () => {
    const course = courseOf("0x1", 20000);
    for (const o of course) {
      expect(o.x).toBeGreaterThanOrEqual(1080);
    }
  });

  it("every obstacle is clearable: jumps reach it and gaps respect the minimum", () => {
    for (const seed of ["0xa", "0xb", "0xc", "0xd"]) {
      expect(courseIsFair(courseOf(seed, 40000))).toBe(true);
    }
  });

  it("a jump can clear every jumpable obstacle", () => {
    const peak = jumpPeak();
    expect(peak).toBeCloseTo(83.3, 1);
    for (const o of courseOf("0x2", 40000)) {
      if (o.kind.jumpable) expect(o.kind.height).toBeLessThan(peak);
    }
  });

  it("the hard gate only shows up once the run has speed", () => {
    for (const o of courseOf("0x3", 60000)) {
      if (o.kind.id === "gate") expect(speedAt(o.x)).toBeGreaterThanOrEqual(o.kind.minSpeed);
    }
  });

  it("collision is honest hitbox overlap, not forgiveness", () => {
    const chog = { x: 100, y: 0, w: 30, h: 40 };
    const rock = { x: 125, y: 0, w: 20, h: 34 };
    expect(overlaps(chog, rock)).toBe(true);
    expect(overlaps(chog, { ...rock, x: 140 })).toBe(false);
  });

  it("the PRNG is deterministic, the course has no hidden randomness", () => {
    const a = prng("seed-1");
    const b = prng("seed-1");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(PHYSICS.gravity).toBe(0.6);
    expect(PHYSICS.jumpVelocity).toBe(-10);
    expect(PHYSICS.maxSpeed).toBe(13);
  });
});
