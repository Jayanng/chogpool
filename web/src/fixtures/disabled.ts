// Production stand-in resolved by vite.config.ts when VITE_FIXTURES is unset.
// It exports nothing but a null, so fixture code is physically absent from
// production bundles. Contains no fixture marker on purpose.

import type { GameSource } from "../types/game";

export const fixtureGameSource: GameSource | null = null;
