// The course: one seeded obstacle field, identical for every player in a
// round. The seed is the round's courseSeed published on chain, so anyone
// can re-derive this exact course from it and check the run against it.
// Nothing here is random at play time: same seed, same course, forever.
//
// The spacing rules are the reference runner's fairness engine, kept whole:
// the first three seconds are clear, every obstacle carries a minimum gap
// so it is always clearable, and harder obstacle kinds cannot appear until
// the run is fast enough to earn them.

import { distanceAfter, jumpPeak, PHYSICS, speedAt, type Hitbox } from "./physics";

/** Dead simple deterministic PRNG seeded from the course seed (splitmix32).
 *  No Math.random anywhere in this file. */
export function prng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    t = (t ^ (t >>> 15)) >>> 0;
    return t / 4294967296;
  };
}

export type ObstacleKind = {
  id: string;
  width: number;
  height: number;
  /** true = cleared by jumping, false = cleared by ducking under it */
  jumpable: boolean;
  /** px of clear track guaranteed after this kind */
  minGap: number;
  /** the kind is hidden until the world is this fast (px/frame) */
  minSpeed: number;
  /** above this world speed, groups of the kind may appear back to back */
  multipleSpeed: number;
};

// Chog-world obstacles. Heights are always under the jump peak (83px) for
// jumpables, so a well-timed jump always clears them; beams hang high so
// running under is the only honest way through.
export const OBSTACLES: ObstacleKind[] = [
  { id: "rock", width: 20, height: 34, jumpable: true, minGap: 120, minSpeed: 0, multipleSpeed: 4 },
  { id: "crate", width: 34, height: 46, jumpable: true, minGap: 160, minSpeed: 6.2, multipleSpeed: 7 },
  { id: "gate", width: 24, height: 92, jumpable: false, minGap: 200, minSpeed: 8.5, multipleSpeed: 999 },
];

/** The reference's opening mercy: no obstacle for the first three seconds,
 *  which at start speed is this many px of clear track. */
export const CLEAR_PX = Math.ceil(distanceAfter(180));

export type PlacedObstacle = {
  kind: ObstacleKind;
  x: number;
  /** the ground row the runner stands on is y = 0; obstacles sit above */
  hitbox: Hitbox;
};

/** Build the round's course. Pure function of the seed: the only source of
 *  variation is the seed itself. `lengthPx` is how long the run is. */
export function courseOf(seed: string, lengthPx: number): PlacedObstacle[] {
  const rand = prng(seed);
  const out: PlacedObstacle[] = [];
  let x = CLEAR_PX;
  while (x < lengthPx) {
    const speed = speedAt(x);
    const eligible = OBSTACLES.filter((k) => speed >= k.minSpeed);
    const kind = eligible[Math.floor(rand() * eligible.length)] ?? OBSTACLES[0];
    // The gap itself is randomised, but never below the kind's minimum, so
    // every obstacle on the field is clearable at this speed.
    const gap = kind.minGap + Math.floor(rand() * kind.minGap);
    x += gap;
    if (x >= lengthPx) break;
    out.push({
      kind,
      x,
      hitbox: { x, y: kind.jumpable ? 0 : -kind.height + 34, w: kind.width, h: kind.height },
    });
    if (speed < kind.multipleSpeed) x += kind.width;
  }
  return out;
}

/** Sanity rule a round must never break: every jumpable obstacle is shorter
 *  than the jump arc, and every gap is at least the kind's minimum. Used by
 *  the tests and available to the game at runtime. */
export function courseIsFair(course: PlacedObstacle[]): boolean {
  const peak = jumpPeak();
  for (let i = 0; i < course.length; i++) {
    const o = course[i];
    if (o.kind.jumpable && o.kind.height >= peak) return false;
    if (i > 0 && o.x - course[i - 1].x < o.kind.minGap) return false;
  }
  return true;
}

export { distanceAfter, speedAt, PHYSICS, jumpPeak };
