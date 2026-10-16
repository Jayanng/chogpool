// Game and race data access. Fixtures load only in dev builds with
// VITE_FIXTURES=1 (alias "web:fixtures"); production builds resolve that alias
// to a null stand-in and read the deployed contracts instead (liveGameSource,
// liveRaceSource), or show honest "nothing deployed" states when
// infra/deployments.json is empty.

import { fixtureGameSource, fixtureRaceSource } from "web:fixtures";
import { liveGameSource } from "./live";
import { liveRaceSource } from "./draw";
import type { GameSource } from "../types/game";
import type { RaceSource } from "../types/race";

export function getGameSource(): GameSource | null {
  if (import.meta.env.VITE_FIXTURES === "1") return fixtureGameSource;
  return liveGameSource;
}

/** Draw records for the race show and the verifier: fixture draws in the
 *  visual dev flow, live contract reads everywhere else. */
export function getRaceSource(): RaceSource | null {
  if (import.meta.env.VITE_FIXTURES === "1") return fixtureRaceSource;
  return liveRaceSource;
}

/** The highest draw id the race source knows, or null when there are none. */
export async function readCurrentRaceId(): Promise<bigint | null> {
  const source = getRaceSource();
  return source ? await source.currentDrawId() : null;
}
