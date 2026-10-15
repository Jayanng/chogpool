// Frozen frontend-facing shapes for contracts that land in Phase 1.
// Mirrors IChogPool (docs/PLAN.md Phase 1): nextDrawAt(), potBalance(), depositOf(tokenId).
// When the real contracts deploy, a live viem GameSource implements this same interface.

export type GameSourceKind = "fixture" | "live";

export interface GameSource {
  kind: GameSourceKind;
  /** Non-empty only in dev fixtures: a bundle sentinel the fixture checker scans for. */
  sentinel: string;
  /** Unix seconds of the next draw, or null when the schedule is not known yet. */
  nextDrawAt(): Promise<number | null>;
  /** Pot balance in smallest unit of the prize token, or null when unknown. */
  potBalance(): Promise<bigint | null>;
  /** Deposit bound to a Chog tokenId (shares), or null when unknown. */
  depositOf(tokenId: bigint): Promise<bigint | null>;
  /** Visual-only deposit step. Fixture implementations simulate; live ones write to chain. */
  deposit(usdcAmount: string, tokenId: bigint): Promise<{ status: string; detail: string }>;
}

export const GAME_LABELS = {
  readNetwork: "Read: Monad Mainnet",
  playNetwork: "Play: Monad Testnet",
} as const;

// Prize-token decimals for display only: PuddleSwap core USDC on testnet has
// 6 decimals (infra/verified.json, verified live 2026-10-14).
export const POT_DECIMALS = 6;
