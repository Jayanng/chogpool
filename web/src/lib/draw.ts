// LIVE draw source: read-only against the deployed DrawEngine, ChogPool,
// CareerStore and ChogMirror (Monad testnet, addresses from the generated
// module). This is the single on-chain source for every race, verifier and
// spectator read. This module never writes.
//
// Public RPC note: testnet-rpc.monad.xyz caps eth_getLogs at a 100-block
// range, so every log read here walks explicit 100-block chunks and reports
// the range it actually scanned. Anything the logs cannot reach is answered
// from contract view calls instead, and the UI says which is which.

import { parseAbiItem, type Address, type Hex } from "viem";
import { DEPLOYED } from "../generated/addresses.gen";
import { testnetReadClient } from "./wallet";
import { careerStoreAbi, drawEngineAbi, mirrorAbi, poolAbi } from "./abi";
import {
  DRAW_STATE_NAMES,
  type DrawEventRecord,
  type DrawRecord,
  type DrawStateName,
  type RaceSource,
  type RacerRecord,
} from "../types/race";

const drawEngine = DEPLOYED.drawEngine as Address;
const pool = DEPLOYED.pool as Address;
const careerStore = DEPLOYED.careerStore as Address;
const mirror = DEPLOYED.mirror as Address;

export function drawStateName(state: number): DrawStateName {
  return DRAW_STATE_NAMES[state] ?? "none";
}

export async function readCurrentDrawId(): Promise<bigint | null> {
  const id = await testnetReadClient.readContract({
    address: drawEngine,
    abi: drawEngineAbi,
    functionName: "currentDrawId",
  });
  return id === 0n ? null : id;
}

export async function readRevealDeadline(): Promise<number> {
  const at = await testnetReadClient.readContract({
    address: drawEngine,
    abi: drawEngineAbi,
    functionName: "revealDeadline",
  });
  return Number(at);
}

/** Full record for one draw: the draw engine's own stored fields plus the
 *  frozen racer book. Returns null when the draw does not exist. */
export async function readDraw(drawId: bigint): Promise<DrawRecord | null> {
  const reads = await testnetReadClient.multicall({
    contracts: [
      { address: drawEngine, abi: drawEngineAbi, functionName: "stateOf", args: [drawId] },
      { address: drawEngine, abi: drawEngineAbi, functionName: "drawCloseAt", args: [drawId] },
      { address: drawEngine, abi: drawEngineAbi, functionName: "commitOf", args: [drawId] },
      { address: drawEngine, abi: drawEngineAbi, functionName: "seedOf", args: [drawId] },
      { address: drawEngine, abi: drawEngineAbi, functionName: "finalRandomnessOf", args: [drawId] },
      { address: drawEngine, abi: drawEngineAbi, functionName: "revealBlockOf", args: [drawId] },
      { address: drawEngine, abi: drawEngineAbi, functionName: "totalTicketsOf", args: [drawId] },
      { address: drawEngine, abi: drawEngineAbi, functionName: "potPerWinnerOf", args: [drawId] },
      { address: drawEngine, abi: drawEngineAbi, functionName: "winnersOf", args: [drawId] },
      { address: pool, abi: poolAbi, functionName: "frozenRacers", args: [drawId] },
    ],
  });
  const values = reads.map((r) => r.result);
  const state = values[0] as number | undefined;
  if (state === undefined) return null;
  if (state === 0) return null; // DrawState.None: no draw with this id

  const racerIds = (values[9] as bigint[] | undefined) ?? [];
  const racerReads = await testnetReadClient.multicall({
    contracts: racerIds.flatMap((tokenId) => [
      { address: drawEngine, abi: drawEngineAbi, functionName: "ticketsOf", args: [drawId, tokenId] },
      { address: drawEngine, abi: drawEngineAbi, functionName: "boostOf", args: [tokenId] },
    ]),
  });
  const racers: RacerRecord[] = racerIds.map((tokenId, i) => {
    const tickets = (racerReads[i * 2]?.result as bigint | undefined) ?? 0n;
    const boost = (racerReads[i * 2 + 1]?.result as [number, bigint] | undefined) ?? [0, 0n];
    return { tokenId, tickets, tier: boost[0], boost: boost[1] };
  });

  return {
    drawId,
    state: drawStateName(state),
    closeAt: Number((values[1] as bigint | undefined) ?? 0n),
    commitHash: (values[2] as Hex | undefined) ?? "0x",
    seed: (values[3] as Hex | undefined) ?? "0x",
    finalRandomness: (values[4] as Hex | undefined) ?? "0x",
    revealBlock: (values[5] as bigint | undefined) ?? 0n,
    totalTickets: (values[6] as bigint | undefined) ?? 0n,
    potPerWinner: (values[7] as bigint | undefined) ?? 0n,
    winners: (values[8] as bigint[] | undefined) ?? [],
    racers,
  };
}

const LOG_CHUNK = 100n; // the RPC's hard eth_getLogs range cap

const revealedEvent = parseAbiItem(
  "event Revealed(uint256 indexed drawId, bytes32 seed, bytes32 finalRandomness, uint256 revealBlock)",
);
const awardedEvent = parseAbiItem(
  "event DrawAwarded(uint256 indexed drawId, uint256[] winnerTokenIds, uint256 potPerWinner)",
);
const raceRecordedEvent = parseAbiItem(
  "event RaceRecorded(uint256 indexed tokenId, uint256 indexed raceId, uint8 placement, int256 fatigueDelta)",
);

/**
 * The award trail of a draw: the reveal, the award, and the CareerStore
 * inscriptions. Scans a bounded window around the reveal block in 100-block
 * chunks. When the draw is not revealed there is no anchor block to scan
 * from, and the answer is an honestly empty trail.
 */
export async function readDrawEvents(draw: DrawRecord): Promise<DrawEventRecord> {
  const empty: DrawEventRecord = {
    scannedFrom: 0n,
    scannedTo: 0n,
    revealedAt: null,
    awardedAt: null,
    inscriptions: [],
  };
  if (draw.revealBlock === 0n) return empty;

  // The operator reveals and awards in one run in practice; the window covers
  // the reveal block plus the blocks around it.
  const from = draw.revealBlock > 200n ? draw.revealBlock - 100n : 0n;
  const to = draw.revealBlock + 600n;

  const revealed: NonNullable<DrawEventRecord["revealedAt"]>[] = [];
  const awarded: NonNullable<DrawEventRecord["awardedAt"]>[] = [];
  const inscriptions: DrawEventRecord["inscriptions"] = [];

  for (let start = from; start <= to; start += LOG_CHUNK) {
    const end = start + LOG_CHUNK - 1n > to ? to : start + LOG_CHUNK - 1n;
    const [revealLogs, awardLogs, careerLogs] = await Promise.all([
      testnetReadClient.getLogs({
        address: drawEngine,
        event: revealedEvent,
        fromBlock: start,
        toBlock: end,
      }),
      testnetReadClient.getLogs({
        address: drawEngine,
        event: awardedEvent,
        fromBlock: start,
        toBlock: end,
      }),
      testnetReadClient.getLogs({
        address: careerStore,
        event: raceRecordedEvent,
        fromBlock: start,
        toBlock: end,
      }),
    ]);
    for (const log of revealLogs) {
      if (log.args.drawId === draw.drawId) {
        revealed.push({
          blockNumber: log.blockNumber ?? 0n,
          txHash: log.transactionHash ?? "0x",
        });
      }
    }
    for (const log of awardLogs) {
      if (log.args.drawId === draw.drawId) {
        awarded.push({
          blockNumber: log.blockNumber ?? 0n,
          txHash: log.transactionHash ?? "0x",
          potPerWinner: log.args.potPerWinner ?? 0n,
        });
      }
    }
    for (const log of careerLogs) {
      if (log.args.raceId === draw.drawId) {
        inscriptions.push({
          tokenId: log.args.tokenId ?? 0n,
          placement: Number(log.args.placement ?? 0),
          fatigueDelta: BigInt(log.args.fatigueDelta ?? 0),
          blockNumber: log.blockNumber ?? 0n,
          txHash: log.transactionHash ?? "0x",
        });
      }
    }
  }

  return {
    scannedFrom: from,
    scannedTo: to,
    revealedAt: revealed[0] ?? null,
    awardedAt: awarded[0] ?? null,
    inscriptions,
  };
}

/** One racer's CareerStore record as the store reads it back today. */
export type CareerRecord = {
  gold: number;
  silver: number;
  bronze: number;
  races: number;
  wins: number;
  fatigue: bigint;
  placementInRace: number; // 0 when this race is not recorded for the racer
};

export async function readCareer(tokenId: bigint, raceId: bigint): Promise<CareerRecord> {
  const [career, placement] = await testnetReadClient.multicall({
    contracts: [
      { address: careerStore, abi: careerStoreAbi, functionName: "getCareer", args: [tokenId] },
      { address: careerStore, abi: careerStoreAbi, functionName: "placementOf", args: [tokenId, raceId] },
    ],
  });
  const c = career.result as
    | { gold: number; silver: number; bronze: number; races: number; wins: number; fatigue: bigint }
    | undefined;
  return {
    gold: c?.gold ?? 0,
    silver: c?.silver ?? 0,
    bronze: c?.bronze ?? 0,
    races: c?.races ?? 0,
    wins: c?.wins ?? 0,
    fatigue: c?.fatigue ?? 0n,
    placementInRace: Number(placement.result ?? 0),
  };
}

/** A racer's mirror badge, exactly as the mirror contract records it. */
export type MirrorBadge = {
  badge: number; // 0 none, 1 Test Drive, 2 Verified Holder
  badgeLabel: string;
  isTestDrive: boolean;
  storedUri: string;
  /** keccak256(bytes(storedUri)) the mirror recorded at mint, when the
   *  deployed mirror exposes it. Old deployments revert on this read. */
  recordedUriHash: Hex | null;
  mainnetOwner: Address;
};

export async function readMirrorBadge(tokenId: bigint): Promise<MirrorBadge> {
  const [badge, isTestDrive, storedUri, mainnetOwner] = await testnetReadClient.multicall({
    contracts: [
      { address: mirror, abi: mirrorAbi, functionName: "badgeOf", args: [tokenId] },
      { address: mirror, abi: mirrorAbi, functionName: "isTestDrive", args: [tokenId] },
      { address: mirror, abi: mirrorAbi, functionName: "tokenURI", args: [tokenId] },
      { address: mirror, abi: mirrorAbi, functionName: "mainnetOwnerOf", args: [tokenId] },
    ],
  });
  let recordedUriHash: Hex | null = null;
  try {
    recordedUriHash = await testnetReadClient.readContract({
      address: mirror,
      abi: mirrorAbi,
      functionName: "uriHashOf",
      args: [tokenId],
    });
  } catch {
    recordedUriHash = null; // deployed mirror predates the URI binding
  }
  const badgeValue = Number(badge.result ?? 0);
  return {
    badge: badgeValue,
    badgeLabel: badgeValue === 1 ? "Test Drive" : badgeValue === 2 ? "Verified Holder" : "No badge recorded",
    isTestDrive: Boolean(isTestDrive.result),
    storedUri: (storedUri.result as string | undefined) ?? "",
    recordedUriHash,
    mainnetOwner: (mainnetOwner.result as Address | undefined) ?? "0x",
  };
}

/** The depositor wallet behind a racer's position (the team the pot pays). */
export async function readTeamWallet(tokenId: bigint): Promise<Address> {
  const result = await testnetReadClient.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "depositOf",
    args: [tokenId],
  });
  return (result as readonly [Address, bigint, bigint])[0];
}

/** The live prize pot, in the pool's smallest asset unit. */
export async function readPotBalance(): Promise<bigint> {
  return testnetReadClient.readContract({ address: pool, abi: poolAbi, functionName: "potBalance" });
}

/** The pool's scheduling truth: 0 means no draw is scheduled. */
export async function readPoolNextDrawAt(): Promise<number | null> {
  const at = await testnetReadClient.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "nextDrawAt",
  });
  return at === 0n ? null : Number(at);
}

export const liveRaceSource: RaceSource = {
  kind: "live",
  sentinel: "", // non-empty only in dev fixtures (fixture checker scans for it)
  currentDrawId: readCurrentDrawId,
  getDraw: readDraw,
};
