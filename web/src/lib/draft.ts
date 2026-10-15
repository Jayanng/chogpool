// Draft Night picks: cosmetic perk choices for the race show.
//
// The draw never reads this store and it never touches the chain: a pick only
// changes how the replay is presented (lane flavor inside the same +25%
// presentation cap). It lives in this browser so the site needs no account and
// makes no promise it cannot keep. The on-chain draw decides the winner.

import type { PerkEffect } from "./race-engine";

const STORAGE_KEY = "chogtrack.draft.v1";

export type DraftPick = {
  drawId: string;
  tokenId: string;
  perk: PerkEffect;
  pickedAt: number;
};

type Store = Record<string, DraftPick>;

function keyOf(drawId: string, tokenId: string): string {
  return `${drawId}:${tokenId}`;
}

function readStore(): Store {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // A browser with storage disabled still gets the show; the pick is just
    // not remembered between loads.
  }
}

export function loadPick(drawId: string, tokenId: string): DraftPick | null {
  return readStore()[keyOf(drawId, tokenId)] ?? null;
}

export function savePick(drawId: string, tokenId: string, perk: PerkEffect): DraftPick {
  const store = readStore();
  const pick: DraftPick = { drawId, tokenId, perk, pickedAt: Date.now() };
  store[keyOf(drawId, tokenId)] = pick;
  writeStore(store);
  return pick;
}

export function clearPick(drawId: string, tokenId: string): void {
  const store = readStore();
  delete store[keyOf(drawId, tokenId)];
  writeStore(store);
}

/** The perk effect for a lane in a replay, or null when nothing was drafted. */
export function perkEffectFor(drawId: string, tokenId: string): PerkEffect | null {
  const pick = loadPick(drawId, tokenId);
  return pick ? pick.perk : null;
}
