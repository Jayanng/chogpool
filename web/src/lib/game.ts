// Game data access. Fixtures load only in dev builds with VITE_FIXTURES=1
// (alias "web:fixtures"); production builds resolve that alias to a null
// stand-in and read the deployed pool instead (liveGameSource), or show honest
// "not deployed" states when infra/deployments.json is empty.

import { fixtureGameSource } from "web:fixtures";
import { liveGameSource } from "./live";
import type { GameSource } from "../types/game";

export function getGameSource(): GameSource | null {
  if (import.meta.env.VITE_FIXTURES === "1") return fixtureGameSource;
  return liveGameSource;
}
