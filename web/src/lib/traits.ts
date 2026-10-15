// Trait helpers and the Draft Night perk catalog.
//
// Chog traits are real off-chain IPFS metadata: nothing here invents a stat.
// What IS ours: the mapping from those real traits to pace flavor, perk offers
// and style labels. Every surface that shows this mapping labels it "our
// design, derived from real traits", and every pace number stays inside the
// same +25% presentation cap the contracts use for trait boosts.

import type { ChogRecord, ChogMetadata } from "./chog";
import { ipfsToGateway } from "./chog";

export type Traits = Record<string, string>;

/** Flatten real IPFS attributes into a key/value map. Values kept verbatim. */
export function traitsOf(metadata: ChogMetadata): Traits {
  const out: Traits = {};
  for (const attr of metadata.attributes ?? []) {
    const key = attr.trait_type?.trim();
    if (!key) continue;
    out[key] = String(attr.value ?? "");
  }
  return out;
}

/** The real Tier trait value, or null when the metadata does not publish one. */
export function tierOf(traits: Traits): string | null {
  for (const key of Object.keys(traits)) {
    if (key.toLowerCase() === "tier") return traits[key];
  }
  return null;
}

export function displayNameOf(record: ChogRecord): string {
  return record.metadata.name ?? `Chog #${record.tokenId.toString()}`;
}

export function imageOf(record: ChogRecord): string | null {
  return record.metadata.image ? ipfsToGateway(record.metadata.image) : null;
}

/** A trait value to weave into perk copy, preferring the richer categories. */
function pickTrait(traits: Traits, wanted: string[]): string | null {
  const keys = Object.keys(traits);
  for (const want of wanted) {
    const hit = keys.find((k) => k.toLowerCase() === want.toLowerCase());
    if (hit && traits[hit]) return traits[hit];
  }
  return null;
}

export type Perk = {
  id: string;
  name: string;
  /** Filled with the racer's real trait values where the template says so. */
  blurb: string;
  /** Cosmetic pace term; the race show caps the total inside +25%. */
  paceDelta: number;
  flair: string;
};

type PerkBlueprint = {
  id: string;
  name: string;
  /** Real trait categories whose values flavor the blurb, most significant first. */
  traitSlots: string[];
  template: (traits: Traits) => string;
  paceDelta: number;
  flair: string;
};

const CATALOG: PerkBlueprint[] = [
  {
    id: "gate-blazer",
    name: "Blazer",
    traitSlots: ["Form", "Body"],
    template: (t) =>
      `Built like a ${pickTrait(t, ["Form", "Body"]) ?? "sprinter"} out of the gates. Fast start, real flair.`,
    paceDelta: 0.02,
    flair: "burst",
  },
  {
    id: "late-kick",
    name: "Late Kick",
    traitSlots: ["Eyes", "Form"],
    template: (t) =>
      `${pickTrait(t, ["Eyes", "Form"]) ?? "Cool"} eyes save everything for the final strides.`,
    paceDelta: 0.015,
    flair: "kick",
  },
  {
    id: "rail-hugger",
    name: "Rail Hugger",
    traitSlots: ["Side", "Skin"],
    template: (t) =>
      `Tucks in along the rail on that ${pickTrait(t, ["Side", "Skin"]) ?? "lean"} frame and steals ground.`,
    paceDelta: 0.01,
    flair: "rail",
  },
  {
    id: "metronome",
    name: "Metronome",
    traitSlots: ["Aura", "Base"],
    template: (t) =>
      `The ${pickTrait(t, ["Aura", "Base"]) ?? "steady"} rhythm type. Never off tempo, never rattled.`,
    paceDelta: 0.012,
    flair: "rhythm",
  },
  {
    id: "slipstream",
    name: "Slipstream",
    traitSlots: ["Background", "Aura"],
    template: (t) =>
      `Reads the ${pickTrait(t, ["Background", "Aura"]) ?? "air"} around the pack and rides the tow.`,
    paceDelta: 0.018,
    flair: "draft",
  },
  {
    id: "crowd-surf",
    name: "Crowd Surf",
    traitSlots: ["Head", "Mouth"],
    template: (t) =>
      `${pickTrait(t, ["Head", "Mouth"]) ?? "Big"} energy. Runs on noise and lives for the big moment.`,
    paceDelta: 0.008,
    flair: "crowd",
  },
  {
    id: "showman",
    name: "Showman",
    traitSlots: ["Tier", "Head"],
    template: (t) =>
      `${pickTrait(t, ["Tier", "Head"]) ?? "Pure"} presence. Pure presentation, pure fun.`,
    paceDelta: 0,
    flair: "sparkle",
  },
  {
    id: "deep-closer",
    name: "Deep Closer",
    traitSlots: ["Mouth", "Eyes"],
    template: (t) =>
      `That ${pickTrait(t, ["Mouth", "Eyes"]) ?? "focused"} look only shows up when the race gets real.`,
    paceDelta: 0.014,
    flair: "closer",
  },
];

/**
 * The three perk offers for one racer in one draw. Deterministic in
 * (drawId, tokenId, real traits): the same Chog in the same draw always sees
 * the same three offers. Presentation layer only, never draw math.
 */
export function perkOffers(drawId: bigint, tokenId: bigint, traits: Traits): Perk[] {
  const sig = Object.keys(traits)
    .sort()
    .map((k) => `${k}=${traits[k]}`)
    .join("|");
  let h = fnv(`${drawId.toString()}:${tokenId.toString()}:${sig}`);
  const pool = [...CATALOG];
  const offers: Perk[] = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    const index = h % pool.length;
    const blueprint = pool.splice(index, 1)[0];
    offers.push({
      id: blueprint.id,
      name: blueprint.name,
      blurb: blueprint.template(traits),
      paceDelta: blueprint.paceDelta,
      flair: blueprint.flair,
    });
    h = fnv(`${h}:${blueprint.id}`);
  }
  return offers;
}

export function findPerk(id: string): Perk | null {
  const blueprint = CATALOG.find((p) => p.id === id);
  if (!blueprint) return null;
  return {
    id: blueprint.id,
    name: blueprint.name,
    blurb: blueprint.template({}),
    paceDelta: blueprint.paceDelta,
    flair: blueprint.flair,
  };
}

/** FNV-1a over a string, returned as an unsigned 32-bit number. */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
