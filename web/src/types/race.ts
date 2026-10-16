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
  /** Trait tier from the live boostOf mapping, read now (0 when never set).
   *  The draw's frozen boost snapshot has no getter, so this is not a
   *  freeze-time value. Display only: winners use raw tickets. */
  tier: number;
  /** Trait boost in 1e18 fixed point, capped at 0.25e18 on chain. Read live
   *  from boostOf, so it is the racer's current on-chain boost, not the draw's
   *  frozen one. Display only: winners use raw tickets. */
  boost: bigint;
};

/** One racer's CareerStore row, exactly as the store reads it back. */
export type CareerSnapshot = {
  gold: number;
  silver: number;
  bronze: number;
  races: number;
  wins: number;
  fatigue: bigint;
  /** 0 when this race is not recorded for the racer. */
  placementInRace: number;
};

/** One RaceRecorded line, as the logs or a draw's own record hold it. */
export type RaceRecordedLine = {
  tokenId: bigint;
  placement: number;
  fatigueDelta: bigint;
  blockNumber: bigint;
  txHash: Hex;
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
  /** Dev draws only: the CareerStore rows this draw carries. Live reads leave
   *  this out and the page reads the deployed CareerStore instead. */
  recordedCareers?: Record<string, CareerSnapshot>;
  /** Dev draws only: the RaceRecorded lines this draw carries. Live reads
   *  leave this out and the page scans real event logs instead. */
  recordedInscriptions?: RaceRecordedLine[];
  /** Dev draws only: one honest line about where this record came from. */
  sourceNote?: string;
  /** Dev draws only: true for a draw that exists ONLY in this record, derived
   *  from real draws but never run on chain. Every surface that shows such a
   *  draw says so and drops the on-chain wording. */
  rehearsal?: boolean;
};

/** The award trail of a draw, read from real event logs where the public RPC allows. */
export type DrawEventRecord = {
  /** Block range actually scanned for events (the RPC caps log ranges at 100 blocks). */
  scannedFrom: bigint;
  scannedTo: bigint;
  revealedAt: { blockNumber: bigint; txHash: Hex } | null;
  awardedAt: { blockNumber: bigint; txHash: Hex; potPerWinner: bigint } | null;
  /** CareerStore inscriptions for this draw (RaceRecorded logs found in range). */
  inscriptions: RaceRecordedLine[];
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
