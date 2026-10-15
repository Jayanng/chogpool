// Shared shapes for draw records and the race show. Winner truth lives on
// chain; every shape here mirrors what the DrawEngine and ChogPool contracts
// actually store and expose. Nothing in this file invents a field the chain
// does not have.

import type { Hex } from "viem";

/** DrawEngine.DrawState, in contract order (None=0 ... Finalized=4). */
export type DrawStateName = "none" | "open" | "closed" | "awarded" | "finalized";

export const DRAW_STATE_NAMES: readonly DrawStateName[] = [
  "none",
  "open",
  "closed",
  "awarded",
  "finalized",
];

/** One racer in a draw's frozen ticket book. */
export type RacerRecord = {
  tokenId: bigint;
  /** Frozen TWAB tickets for this draw (DrawEngine.ticketsOf). */
  tickets: bigint;
  /** Trait tier recorded at freeze (0 when never set). */
  tier: number;
  /** Trait boost in 1e18 fixed point, capped at 0.25e18 on chain. */
  boost: bigint;
};

/** One draw, exactly as the chain records it. */
export type DrawRecord = {
  drawId: bigint;
  state: DrawStateName;
  /** Unix seconds the commit window ends (DrawEngine.drawCloseAt). */
  closeAt: number;
  /** Operator commit over the seed, bytes32(0) until committed. */
  commitHash: Hex;
  /** The revealed seed, bytes32(0) until revealed. */
  seed: Hex;
  /** keccak256(seed, blockhash(revealBlock), drawId), bytes32(0) until revealed. */
  finalRandomness: Hex;
  /** Block whose blockhash is bound into the randomness (0 until revealed). */
  revealBlock: bigint;
  totalTickets: bigint;
  /** Asset amount paid to each winner (0 until awarded). */
  potPerWinner: bigint;
  /** Winners in payout order. Empty until award() runs. */
  winners: bigint[];
  racers: RacerRecord[];
};

/** The award trail of a draw, read from real event logs where the public RPC allows. */
export type DrawEventRecord = {
  /** Block range actually scanned for events (the RPC caps log ranges at 100 blocks). */
  scannedFrom: bigint;
  scannedTo: bigint;
  revealedAt: { blockNumber: bigint; txHash: Hex } | null;
  awardedAt: { blockNumber: bigint; txHash: Hex; potPerWinner: bigint } | null;
  /** CareerStore inscriptions for this draw (RaceRecorded logs found in range). */
  inscriptions: Array<{ tokenId: bigint; placement: number; fatigueDelta: bigint; blockNumber: bigint; txHash: Hex }>;
};

export interface RaceSource {
  kind: "live" | "fixture";
  /** Non-empty only in dev fixtures: a bundle sentinel the fixture checker scans for. */
  sentinel: string;
  /** Highest draw id on chain, or null when the engine has no draws. */
  currentDrawId(): Promise<bigint | null>;
  /** Full record for one draw, or null when that draw does not exist. */
  getDraw(drawId: bigint): Promise<DrawRecord | null>;
}
