// Game data access. Until the Phase 1 contracts deploy there is NO live source;
// the app then shows honest "schedule announced with the pool contract" states.
// Fixtures load only in dev builds with VITE_FIXTURES=1 (alias "web:fixtures").

import { fixtureGameSource } from "web:fixtures";
import type { GameSource } from "../types/game";

export function getGameSource(): GameSource | null {
  if (import.meta.env.VITE_FIXTURES === "1") return fixtureGameSource;
  return null;
}
