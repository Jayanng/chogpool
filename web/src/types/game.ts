// Frozen frontend-facing shapes for the deployed ChogPool.
// Mirrors IChogPool exactly: nextDrawAt(), potBalance(), depositOf(tokenId),
// twabOf(tokenId), oddsBpsOf(tokenId), withdrawAll(tokenId). When a method is
// added here, the live viem GameSource implements it against the deployed
// contract with the same name, arguments and meaning.

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
  /** Time-weighted average balance of a Chog position (IChogPool.twabOf). */
  twabOf(tokenId: bigint): Promise<bigint | null>;
  /** Win probability out of the live book, in basis points 0..10000 (IChogPool.oddsBpsOf). */
  oddsBpsOf(tokenId: bigint): Promise<bigint | null>;
  /** Visual-only deposit step. Fixture implementations simulate; live ones write to chain. */
  deposit(usdcAmount: string, tokenId: bigint): Promise<{ status: string; detail: string }>;
  /** Withdraw the full position for a Chog, instantly (IChogPool.withdrawAll). Wallet-driven. */
  withdrawAll(tokenId: bigint): Promise<{ status: string; detail: string }>;
}

export const GAME_LABELS = {
  readNetwork: "Read: Monad Mainnet",
  playNetwork: "Play: Monad Testnet",
} as const;

// Prize-token decimals for display only: PuddleSwap core USDC on testnet has
// 6 decimals (infra/verified.json, verified live 2026-10-14).
export const POT_DECIMALS = 6;
