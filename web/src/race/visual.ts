// Visual-only helpers for the race show: presentation math for the runners,
// the podium ceremony and the prize count-up. Nothing here decides, derives or
// rewords a result; every value it returns is a restatement of one the draw
// already records.

/** How far the runner's nose rides past the checkered column at the finish:
 *  the character breaks the line instead of hiding it. */
export const FINISH_OVERLAP_PX = 22;

/** Runner travel inside its track: progress 0..1 maps to 0 .. (track minus the
 *  runner's own width and the finish overlap), so the runner's nose breaks the
 *  checkered line at exactly 1. The width comes from the track's --runner-w
 *  variable, with the given width as the fallback so art and math cannot
 *  disagree. */
export function runnerLeft(progress: number, runnerWidthPx: number): string {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return `calc((100% - var(--runner-w, ${runnerWidthPx}px) - ${FINISH_OVERLAP_PX}px) * ${p.toFixed(4)})`;
}

/** Width of the trail the runner drags along, same travel as runnerLeft. */
export function trailWidth(progress: number): string {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return `calc((100% - ${FINISH_OVERLAP_PX}px) * ${p.toFixed(4)})`;
}

/** 0..1 clock for the podium prize count-up. */
export function countUpT(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  if (elapsedMs <= 0) return 0;
  return Math.min(1, elapsedMs / durationMs);
}

/** Count from one bigint to another along t in [0, 1]. Waypoints are rough
 *  on purpose (they only ever flash on screen mid-animation) and the value at
 *  t >= 1 is exactly the real number. */
export function countUpValue(from: bigint, to: bigint, t: number): bigint {
  if (t >= 1) return to;
  if (t <= 0) return from;
  const span = to - from;
  return from + BigInt(Math.floor(Number(span) * t));
}

/** "1ST", "2ND", "3RD", "4TH" for a podium rank badge. Place numbers are the
 *  winning places the draw decides. */
export function ordinalPlace(place: number): string {
  const n = Math.max(1, Math.floor(place));
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "TH" : n % 10 === 1 ? "ST" : n % 10 === 2 ? "ND" : n % 10 === 3 ? "RD" : "TH";
  return `${n}${suffix}`;
}

/* ------------------------------------------------------------------ *
 * Confetti layout. The scatter is a pure function of the draw's own
 * randomness: same seed, same celebration, every time. Nothing here
 * decides or rewords a result.
 * ------------------------------------------------------------------ */

/** Tiny deterministic PRNG seeded from the draw randomness, with an optional
 *  salt so two celebrations of the same draw never scatter identically. */
export function seededRandom(seed: string, salt = 0): () => number {
  let state = salt >>> 0;
  for (let i = 2; i < seed.length; i += 2) {
    state = (Math.imul(state, 31) + parseInt(seed.slice(i, i + 2), 16)) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** One confetti piece as the field lays it out. The animation moves the piece
 *  from here; the spawn numbers themselves never change. */
export type ConfettiSpawn = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Outward kick for the burst on mount, decaying into the plain fall. */
  kickX: number;
  kickY: number;
  size: number;
  spin: number;
  angle: number;
  /** Index into the confetti palette. */
  colorIndex: number;
  streamer: boolean;
  /** 0 far, 1 mid, 2 near: the depth layer sets size, speed and opacity. */
  depth: number;
};

const DEPTH_SIZE = [0.45, 1, 2.4];
const DEPTH_SPEED = [0.62, 1, 1.45];
const DEPTH_ALPHA = [0.38, 0.75, 1];

export function confettiDepthSize(depth: number): number {
  return DEPTH_SIZE[depth] ?? 1;
}
export function confettiDepthSpeed(depth: number): number {
  return DEPTH_SPEED[depth] ?? 1;
}
export function confettiDepthAlpha(depth: number): number {
  return DEPTH_ALPHA[depth] ?? 1;
}

/**
 * The podium's confetti field: dense at the top and thinning downward, with
 * near and far pieces layered for depth, varied spin and fall speeds, and an
 * outward kick on mount so the field bursts and then settles into a fall.
 * "burst" keeps the finish-line blast, where every piece leaves one point at
 * once. Pure: the rand stream alone decides the whole layout.
 */
export function confettiField(
  rand: () => number,
  width: number,
  height: number,
  count: number,
  mode: "fall" | "burst",
): ConfettiSpawn[] {
  const out: ConfettiSpawn[] = [];
  for (let i = 0; i < count; i++) {
    const colorIndex = Math.floor(rand() * 8);
    const streamer = rand() > 0.55;
    const depthRoll = rand();
    const depth = depthRoll < 0.4 ? 0 : depthRoll < 0.78 ? 1 : 2;
    const depthSpeed = confettiDepthSpeed(depth);
    if (mode === "burst") {
      // Explode outward from just left of the checkered line.
      const angle = rand() * Math.PI * 2;
      const speed = (2 + rand() * 6.5) * depthSpeed;
      out.push({
        x: width * 0.9,
        y: height * 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.5,
        kickX: 0,
        kickY: 0,
        size: (6 + rand() * 10) * confettiDepthSize(depth),
        spin: (rand() - 0.5) * 0.35,
        angle,
        colorIndex,
        streamer,
        depth,
      });
      continue;
    }
    const x = rand() * width;
    // Top-heavy: cubing the roll packs the pieces toward the top of the
    // frame and lets the field thin out as it falls away.
    const u = rand();
    const y = height * u * u * u * 0.92 - height * 0.04;
    // The burst on mount: pieces fly up and outward from the top center,
    // then the kick dies out and the fall takes over.
    const dx = width > 0 ? (x - width / 2) / (width / 2) : 0;
    out.push({
      x,
      y,
      vx: (rand() - 0.5) * 1.4,
      vy: (0.8 + rand() * 1.7) * depthSpeed,
      kickX: dx * (3 + rand() * 5),
      kickY: -(1.5 + rand() * 4) * (1 - Math.abs(dx) * 0.45),
      size: (5 + rand() * 7) * confettiDepthSize(depth),
      spin: (rand() - 0.5) * 0.5,
      angle: rand() * Math.PI * 2,
      colorIndex,
      streamer,
      depth,
    });
  }
  return out;
}
