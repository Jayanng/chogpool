// LIVE career source: read-only against the deployed CareerStore (Monad testnet,
// address from the generated module). Real per-Chog records only: trophies, wins,
// races, fatigue and the placement recorded for each race. Nothing here is
// invented. A Chog with no recorded races is a real empty career; a read that
// does not answer is an error, never dressed up as an empty one.

import { formatUnits, type Address } from "viem";
import { DEPLOYED } from "../generated/addresses.gen";
import { testnetReadClient } from "./wallet";
import { careerStoreAbi } from "./abi";
import { readCurrentDrawId, readDraw } from "./draw";

const careerStore = DEPLOYED.careerStore as Address;

/** The one id range the collection and every UI input accept. */
const MIN_TOKEN_ID = 1n;
const MAX_TOKEN_ID = 1969n;

export type RaceHistoryRow = {
  raceId: bigint;
  /** Finishing placement the CareerStore recorded: 1/2/3 are the podium and a
   *  higher number is a finish without one. 0 means the store holds no
   *  placement for this race. null means the placement did not read back on
   *  this RPC, so it is left unknown rather than invented. */
  placement: number | null;
};

/** One Chog's whole career, exactly as the CareerStore reads it back today. */
export type CareerProfile = {
  tokenId: bigint;
  gold: number;
  silver: number;
  bronze: number;
  races: number;
  wins: number;
  /** Unix seconds of the last recorded race, 0 when the Chog has never raced. */
  lastRaceAt: number;
  /** 1e18 fixed point, 0 = fresh, higher = burdened. */
  fatigue: bigint;
  /** 1e18 = neutral odds; below 1e18 is a fatigue drag. */
  fatigueMultiplier: bigint;
  raceIds: bigint[];
  history: RaceHistoryRow[];
};

/** The CareerStore's getCareer tuple, before it is normalised. */
type CareerFields = {
  gold: number;
  silver: number;
  bronze: number;
  races: number;
  wins: number;
  lastRaceAt: number;
  fatigue: bigint;
};

/** Fatigue as a 0-1 level for display (1e18 fixed point in, fraction out). */
export function fatigueLevel(fatigue: bigint): number {
  return Number(formatUnits(fatigue, 18));
}

/** Odds multiplier as a fraction for display (1e18 = neutral 1.0). */
export function multiplierValue(multiplier: bigint): number {
  return Number(formatUnits(multiplier, 18));
}

export function placementLabel(placement: number | null): string {
  if (placement === null) return "Unavailable";
  if (placement === 1) return "1st";
  if (placement === 2) return "2nd";
  if (placement === 3) return "3rd";
  return "Ran";
}

/**
 * One Chog's career: the summary, its fatigue odds, and every recorded race.
 *
 * Throws when the id is outside 1-1,969 or when the CareerStore does not answer,
 * so a caller can always tell a failed read from a Chog that simply has no races
 * (which comes back as a normal profile with zero races).
 */
export async function readCareerProfile(tokenId: bigint): Promise<CareerProfile> {
  if (tokenId < MIN_TOKEN_ID || tokenId > MAX_TOKEN_ID) {
    throw new Error(`Chog ID ${tokenId} is outside the ${MIN_TOKEN_ID}-${MAX_TOKEN_ID} range.`);
  }

  let career: unknown;
  let raceIdsRaw: unknown;
  let multiplierRaw: unknown;
  try {
    [career, raceIdsRaw, multiplierRaw] = await Promise.all([
      testnetReadClient.readContract({ address: careerStore, abi: careerStoreAbi, functionName: "getCareer", args: [tokenId] }),
      testnetReadClient.readContract({ address: careerStore, abi: careerStoreAbi, functionName: "racesOf", args: [tokenId] }),
      testnetReadClient.readContract({ address: careerStore, abi: careerStoreAbi, functionName: "fatigueMultiplierOf", args: [tokenId] }),
    ]);
  } catch (cause) {
    throw new Error(`The CareerStore did not answer for Chog #${tokenId} on this RPC.`, { cause });
  }

  // getCareer returns the store's all-zero mapping default for a Chog that has
  // never raced, which is a real empty career and is normalised field by field.
  // A record that does not decode to that shape is absent or corrupt data and is
  // an error, never a fake empty career.
  if (career === null || typeof career !== "object" || Array.isArray(career)) {
    throw new Error("The CareerStore record for Chog #" + String(tokenId) + " did not decode to a readable shape.");
  }
  const c = career as Partial<CareerFields>;
  if (c.gold === undefined || c.races === undefined || c.fatigue === undefined) {
    throw new Error("The CareerStore record for Chog #" + String(tokenId) + " is missing expected fields.");
  }
  const ids = Array.isArray(raceIdsRaw) ? (raceIdsRaw as bigint[]) : [];

  // Each placement reads on its own: one race that will not answer must not
  // blank the rest of the history, and a missing placement is left unknown.
  const history: RaceHistoryRow[] = await Promise.all(
    ids.map(async (raceId): Promise<RaceHistoryRow> => {
      try {
        const placement = await testnetReadClient.readContract({
          address: careerStore,
          abi: careerStoreAbi,
          functionName: "placementOf",
          args: [tokenId, raceId],
        });
        return { raceId, placement: Number(placement ?? 0) };
      } catch {
        return { raceId, placement: null };
      }
    }),
  );

  // The fatigue and odds values are 1e18 fixed points the store returns as
  // uint256; accept them only when they decode to a bigint, else fall back.
  const fatigue = typeof c.fatigue === "bigint" ? c.fatigue : 0n;
  const multiplier = typeof multiplierRaw === "bigint" ? multiplierRaw : 10n ** 18n;

  return {
    tokenId,
    gold: Number(c.gold ?? 0),
    silver: Number(c.silver ?? 0),
    bronze: Number(c.bronze ?? 0),
    races: Number(c.races ?? 0),
    wins: Number(c.wins ?? 0),
    lastRaceAt: Number(c.lastRaceAt ?? 0),
    fatigue,
    fatigueMultiplier: multiplier,
    raceIds: ids,
    history,
  };
}

/** One row of the standings. */
export type LadderEntry = {
  tokenId: bigint;
  gold: number;
  silver: number;
  bronze: number;
  wins: number;
  races: number;
};

/**
 * The standings: every Chog with at least one recorded race, ranked by wins,
 * then trophies, then races. Built from the draws' racer books and each Chog's
 * real CareerStore record. A Chog with no recorded race is left off the board
 * rather than shown with a fake zero, and a career that will not read is
 * skipped instead of inventing a row.
 */
export async function readLadder(): Promise<LadderEntry[]> {
  const currentId = await readCurrentDrawId();
  if (currentId === null) return [];

  // Every Chog that has ever lined up in a draw, from the frozen books.
  const tokenIds = new Set<bigint>();
  for (let id = 1n; id <= currentId; id++) {
    const draw = await readDraw(id);
    if (draw) for (const racer of draw.racers) tokenIds.add(racer.tokenId);
  }

  const rows = await Promise.all(
    [...tokenIds].map(async (tokenId): Promise<LadderEntry | null> => {
      try {
        const c = await readCareerProfile(tokenId);
        if (c.races === 0) return null;
        return { tokenId, gold: c.gold, silver: c.silver, bronze: c.bronze, wins: c.wins, races: c.races };
      } catch {
        return null;
      }
    }),
  );

  const trophyScore = (e: LadderEntry) => e.gold * 3 + e.silver * 2 + e.bronze;
  return rows
    .filter((e): e is LadderEntry => e !== null)
    .sort((a, b) => b.wins - a.wins || trophyScore(b) - trophyScore(a) || b.races - a.races);
}
