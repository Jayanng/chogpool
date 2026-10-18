// Race art: a stylized Chog derived from a racer's REAL IPFS traits.
//
// Presentation only. Nothing here decides, derives or rewords a result: every
// input is one the draw or the metadata already records, and the same inputs
// always produce the same sprite. This is "our design from real traits" (the
// same honest boundary as pace and boost mapping), and it is only ever called
// for racers whose metadata actually loaded: a racer with unreachable metadata
// gets an honest placeholder, never an invented Chog.

export type PerkCosmetic = "none" | "bandana" | "goggles" | "cape";
export type Marking = "none" | "stripe" | "spots" | "patch";

export type ChogAppearance = {
  /** Deterministic hue anchor, 0..359, derived from the real trait values. */
  hue: number;
  body: string;
  belly: string;
  accent: string;
  marking: Marking;
  /** True when the racer carries any on-chain trait boost. */
  aura: boolean;
  /** Boost fill 0..1 against the contract's +25% cap. */
  auraStrength: number;
  perk: PerkCosmetic;
};

/** Mirrors DrawEngine.MAX_BOOST: trait boosts cannot exceed +25%. */
export const MAX_BOOST = 0.25;

/** FNV-1a: small, fast, stable across runs. Deterministic art needs a
 *  deterministic hash, not a random one. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Boost in 1e18 fixed point -> fill 0..1 against MAX_BOOST, hard capped. */
export function boostRatioOf(boost: bigint): number {
  if (boost <= 0n) return 0;
  const ratio = Number(boost) / 1e18 / MAX_BOOST;
  return ratio > 1 ? 1 : ratio;
}

export function appearanceOf(input: {
  tier: string;
  traits: Record<string, string>;
  boost: bigint;
  perkId?: string | null;
}): ChogAppearance {
  const keys = Object.keys(input.traits).sort();
  const canonical = [input.tier, ...keys.map((k) => `${k}:${input.traits[k]}`)].join("|");
  const h = fnv1a(canonical);
  const hue = h % 360;
  const marking: Marking = (["none", "stripe", "spots", "patch"] as Marking[])[(h >>> 9) % 4];
  const perk: PerkCosmetic = input.perkId
    ? (["bandana", "goggles", "cape", "none"] as PerkCosmetic[])[fnv1a(input.perkId) % 4]
    : "none";
  const auraStrength = boostRatioOf(input.boost);
  return {
    hue,
    body: `hsl(${hue} 58% 62%)`,
    belly: `hsl(${hue} 48% 84%)`,
    accent: `hsl(${(hue + 40) % 360} 70% 46%)`,
    marking,
    aura: auraStrength > 0,
    auraStrength,
    perk,
  };
}
