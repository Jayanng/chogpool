// The race engine: a deterministic replay generator.
//
// The on-chain draw result is the ONLY source of who wins. This module turns
// that result (the published final randomness, the frozen ticket book, the
// racers' real IPFS traits and the frozen params below) into per-lane progress
// curves for the show. Same inputs always produce the same frames. It never
// calls the network, never reads the clock and never rolls dice.

import { keccak256, concat, toHex, type Hex } from "viem";

/** Frozen presentation parameters. Changing these changes every replay, so
 *  they are versioned; a replay records which version drew it. */
export const RACE_PARAMS = {
  version: 1,
  /** Curve resolution: each lane's run is drawn as this many speed segments. */
  segments: 24,
  /** Hard presentation cap on trait and perk pace, mirroring the contract's
   *  +25% boost cap (DrawEngine.MAX_BOOST). */
  boostCap: 0.25,
  /** Photo-finish gap between winner and runner-up, as a fraction of the race. */
  photoFinishGapMin: 0.006,
  photoFinishGapMax: 0.022,
  /** Baseline gap added between later finishers. */
  spreadMin: 0.014,
  spreadMax: 0.032,
} as const;

export type RaceParams = typeof RACE_PARAMS;

/** A cosmetic perk picked on Draft Night. Presentation only. */
export type PerkEffect = { id: string; name: string; paceDelta: number };

export type RaceLaneInput = {
  tokenId: bigint;
  /** Frozen TWAB tickets for the draw (real on-chain number). */
  tickets: bigint;
  /** Trait boost in 1e18 fixed point as recorded on chain (0..0.25e18). */
  boost: bigint;
  /** Real Tier trait value from IPFS metadata, or "" when unknown. */
  tier: string;
  /** Real trait key/values from IPFS metadata. */
  traits: Record<string, string>;
  /** Cosmetic Draft Night perk, if the fan picked one. */
  perk?: PerkEffect | null;
};

export type RaceInput = {
  drawId: bigint;
  finalRandomness: Hex;
  /** Winners exactly as the chain recorded them (winnersOf), payout order. */
  winners: bigint[];
  lanes: RaceLaneInput[];
  params?: RaceParams;
};

export type RaceLane = {
  tokenId: bigint;
  /** 0 = winner. */
  rank: number;
  /** Normalized time at which this lane crosses the line, in (0, 1). */
  finishTime: number;
  /** Presentation pace actually applied (our design), inside the cap. */
  paceBoost: number;
  /** Our-design pace label derived from the racer's real traits. */
  style: string;
  shape: "early" | "even" | "late";
  /** Per-segment speed multipliers, mean 1 over the run. Presentation only. */
  speeds: number[];
  /** Cumulative progress fraction at the end of each segment. */
  progressCurve: number[];
};

export type RaceReplay = {
  drawId: bigint;
  finalRandomness: Hex;
  params: RaceParams;
  lanes: RaceLane[];
  finishOrder: bigint[];
  winner: bigint;
  /** Time between first and second across the line (normalized). */
  photoFinishGap: number;
  /** All-lane progress at normalized time t in [0, 1], in `lanes` order. */
  progressAt(t: number): number[];
  /** count frames from t = 0 to t = 1, each frame one progress value per lane. */
  frames(count: number): number[][];
};

const STYLES = [
  "FRONT RUNNER",
  "LATE KICKER",
  "STEADY ENGINE",
  "GATE BLAZER",
  "DEEP CLOSER",
  "LANE SURFER",
  "METRONOME",
  "SLIPSTREAM",
] as const;

/**
 * Deterministic finishing order: the on-chain winners stay exactly as the
 * chain recorded them (payout order), and the remaining racers are ordered by
 * a hash of the draw randomness, so the show's tail is reproducible too.
 */
export function deriveFinishOrder(
  finalRandomness: Hex,
  winners: bigint[],
  laneTokenIds: bigint[],
): bigint[] {
  const lanes = new Map(laneTokenIds.map((t) => [t.toString(), t]));
  const out: bigint[] = [];
  const seen = new Set<string>();
  for (const tokenId of winners) {
    const key = tokenId.toString();
    if (lanes.has(key) && !seen.has(key)) {
      out.push(lanes.get(key) as bigint);
      seen.add(key);
    }
  }
  const rest = laneTokenIds.filter((t) => !seen.has(t.toString()));
  rest.sort((a, b) => {
    const ha = BigInt(hashOf(finalRandomness, "order", 0, a));
    const hb = BigInt(hashOf(finalRandomness, "order", 0, b));
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
  return [...out, ...rest];
}

/** Build the full deterministic replay for a draw. */
export function buildRaceReplay(input: RaceInput): RaceReplay {
  const params = input.params ?? RACE_PARAMS;
  const seed = input.finalRandomness;
  const lanesIn = input.lanes;
  const n = lanesIn.length;

  const order = deriveFinishOrder(seed, input.winners, lanesIn.map((l) => l.tokenId));
  const rankOf = new Map(order.map((tokenId, i) => [tokenId.toString(), i]));

  const totalTickets = lanesIn.reduce((acc, l) => acc + l.tickets, 0n);

  // Photo finish and spread come from the seed alone.
  const gap =
    params.photoFinishGapMin +
    rand(seed, "photo", 0) * (params.photoFinishGapMax - params.photoFinishGapMin);
  const spread = params.spreadMin + rand(seed, "spread", 0) * (params.spreadMax - params.spreadMin);

  const lanes: RaceLane[] = lanesIn.map((lane) => {
    const rank = rankOf.get(lane.tokenId.toString()) ?? n - 1;

    // Finishing times: strictly ordered by rank, winner just ahead of the
    // runner-up so the finish reads as a photo finish.
    let finishTime: number;
    if (rank === 0) {
      finishTime = 0.975 - rand(seed, "ft", 0) * 0.01;
    } else if (rank === 1) {
      finishTime = 0.975 - rand(seed, "ft", 0) * 0.01 + gap;
    } else {
      const jitter = (rand(seed, "ft", rank) - 0.5) * 0.004;
      finishTime = 0.975 - rand(seed, "ft", 0) * 0.01 + gap + (rank - 1) * spread + jitter;
    }
    finishTime = clamp(finishTime, 0.2, 0.998);

    // Presentation pace: the on-chain trait boost, the Draft Night perk and a
    // small trait-derived term, all inside the +25% cap. This shapes how the
    // run looks; it never decides who wins.
    const onChainBoost = clamp(Number(lane.boost) / 1e18, 0, params.boostCap);
    const traitPace = traitPaceOf(lane.traits);
    const perkDelta = lane.perk ? lane.perk.paceDelta : 0;
    const paceBoost = clamp(onChainBoost + traitPace + perkDelta, -params.boostCap, params.boostCap);
    const shapeIndex = traitShapeOf(lane.traits, seed, lane.tokenId);
    const shape: "early" | "even" | "late" = shapeIndex === 0 ? "early" : shapeIndex === 1 ? "even" : "late";

    // Speed profile: a smooth rhythm (interpolated coarse noise) plus a fine
    // jitter, tilted by the lane's shape, all deterministic per lane.
    const tilt = shape === "late" ? 0.55 : shape === "early" ? -0.55 : 0;
    const ticketShare = totalTickets === 0n ? 0 : Number(lane.tickets) / Number(totalTickets);
    // Bigger books run calmer runs; small books swing more. Presentation only.
    const wobbleAmp = 0.3 - 0.12 * clamp(ticketShare * n, 0, 1) + 0.06 * clamp(traitPace * 8, -1, 1);
    const speeds = buildSpeeds(seed, lane.tokenId, params.segments, tilt, wobbleAmp, paceBoost);
    const progressCurve = cumulativeCurve(speeds);

    const style = STYLES[Math.floor(rand(seed, "style", rank) * STYLES.length) % STYLES.length];
    return { tokenId: lane.tokenId, rank, finishTime, paceBoost, style, shape, speeds, progressCurve };
  });

  const sorted = [...lanes].sort((a, b) => a.rank - b.rank);

  function progressAt(t: number): number[] {
    const clamped = clamp(t, 0, 1);
    return sorted.map((lane) => laneProgress(lane, clamped));
  }

  function frames(count: number): number[][] {
    const out: number[][] = [];
    const steps = Math.max(1, count);
    for (let i = 0; i < steps; i++) {
      out.push(progressAt(steps === 1 ? 1 : i / (steps - 1)));
    }
    return out;
  }

  return {
    drawId: input.drawId,
    finalRandomness: seed,
    params,
    lanes: sorted,
    finishOrder: order,
    winner: order.length > 0 ? order[0] : 0n,
    photoFinishGap: gap,
    progressAt,
    frames,
  };
}

// ---------------------------------------------------------------- internals

/** Progress of one lane at normalized time t. Exactly 1 from its finish on. */
function laneProgress(lane: RaceLane, t: number): number {
  if (t >= lane.finishTime) return 1;
  const segments = lane.speeds.length;
  const x = t / lane.finishTime; // 0..1 along the lane's own run
  const pos = x * segments;
  const k = Math.min(segments - 1, Math.floor(pos));
  const frac = pos - k;
  const from = lane.progressCurve[k];
  const to = lane.progressCurve[k + 1];
  return clamp(from + (to - from) * frac, 0, 1);
}

/** Cumulative fraction of the run completed at the end of each segment. */
function cumulativeCurve(speeds: number[]): number[] {
  const total = speeds.reduce((a, b) => a + b, 0);
  const curve = [0];
  let acc = 0;
  for (const speed of speeds) {
    acc += speed / total;
    curve.push(acc);
  }
  curve[curve.length - 1] = 1; // exact, no drift at the finish
  return curve;
}

/** Per-segment speed multipliers. Positive, deterministic per lane. */
function buildSpeeds(
  seed: Hex,
  tokenId: bigint,
  segments: number,
  tilt: number,
  wobbleAmp: number,
  paceBoost: number,
): number[] {
  const coarse = 6;
  const coarseValues: number[] = [];
  for (let k = 0; k < coarse; k++) {
    coarseValues.push((rand(seed, "coarse", k, tokenId) - 0.5) * 2);
  }
  const speeds: number[] = [];
  for (let k = 0; k < segments; k++) {
    const x = k / (segments - 1);
    // Interpolated coarse rhythm.
    const pos = x * (coarse - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(coarse - 1, i0 + 1);
    const frac = pos - i0;
    const rhythm = coarseValues[i0] * (1 - frac) + coarseValues[i1] * frac;
    // Fine jitter.
    const jitter = (rand(seed, "fine", k, tokenId) - 0.5) * 2;
    // Shape tilt: late kickers accelerate, front runners fade a little.
    const tiltTerm = tilt * (x - 0.5);
    // A capped burst tied to the presentation boost, strongest off the gates.
    const burst = paceBoost * 0.6 * (1 - x);
    const speed = 1 + wobbleAmp * rhythm + 0.12 * jitter + tiltTerm + burst;
    speeds.push(Math.max(0.15, speed));
  }
  return speeds;
}

/**
 * Small deterministic pace term from the racer's real traits. This is OUR
 * design layer on real metadata (the UI labels it as such), kept tiny and
 * always inside the presentation cap.
 */
function traitPaceOf(traits: Record<string, string>): number {
  const keys = Object.keys(traits).sort();
  let sum = 0;
  for (const key of keys) {
    sum += (byteHash(`${key}=${traits[key]}`) / 255 - 0.5) * 0.06;
  }
  return clamp(sum, -0.06, 0.06);
}

function traitShapeOf(traits: Record<string, string>, seed: Hex, tokenId: bigint): number {
  const sig = Object.keys(traits)
    .sort()
    .map((k) => `${k}=${traits[k]}`)
    .join("|");
  const h = byteHash(sig) + Number(BigInt(hashOf(seed, "shape", 0, tokenId)) % 251n);
  return h % 3; // 0 early, 1 even, 2 late
}

/** Deterministic uniform in [0, 1) from the draw randomness. */
function rand(seed: Hex, tag: string, i: number, tokenId?: bigint): number {
  const h = hashOf(seed, tag, i, tokenId);
  return Number(BigInt(h) >> 224n) / 0x1_0000_0000;
}

function hashOf(seed: Hex, tag: string, i: number, tokenId?: bigint): Hex {
  return keccak256(
    concat([seed, toHex(tag), toHex(i, { size: 8 }), toHex(tokenId ?? 0n, { size: 32 })]),
  );
}

/** Tiny stable string hash for trait mixing (FNV-1a). */
function byteHash(text: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h & 0xff;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
