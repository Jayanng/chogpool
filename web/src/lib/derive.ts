// Pure re-derivation of a draw's result, byte-exact against DrawEngine
// (contracts/src/DrawEngine.sol). This module is the /verify page's math and the
// race show's proof trail. It never touches the network.
//
// The deployed contract picks winners like this (DrawEngine._deriveWinners):
//   racers   = the draw's frozen racer list, in the order ChogPool recorded it
//   for i in 0..winnerCount-1:
//     h   = keccak256(finalRandomness ++ uint256(i))      // 64 bytes packed
//     idx = uint256(h) % totalTickets
//     tokenId = the racer under index idx in the cumulative ticket walk
//     if tokenId was already picked, walk the racer list from
//       racers[(uint256(h) + k) % n] for k = 0..n-1 and take the first
//       unpicked racer
// Nothing else enters the math: no tier, no boost, no per-racer hash. The
// winner-check sketch in the frozen interface header (a per-racer
// keccak(drawId, tokenId, ...) zone comparison) does not describe this
// implementation; this module follows the implementation, because the
// implementation is what runs on chain. Verified against live Draw 1 on Monad
// testnet: recomputed final randomness and winner 1462 both match the chain.

import { concat, keccak256, toHex, type Hex } from "viem";

export type DerivedWinner = {
  /** Winner slot, 0-based, matching winnersOf() order. */
  slot: number;
  /** keccak256(finalRandomness ++ uint256(slot)). */
  h: Hex;
  /** uint256(h) % totalTickets. */
  index: bigint;
  /** tokenId found under that index in the cumulative walk. */
  picked: bigint;
  /** True when the primary pick collided with an earlier winner and the
   *  deterministic forward walk took over. */
  walked: boolean;
};

export type DerivationResult = {
  winners: bigint[];
  steps: DerivedWinner[];
};

export type RacerTickets = { tokenId: bigint; tickets: bigint };

/** keccak256(abi.encodePacked(seed)) is what the operator commits. */
export function commitHashOf(seed: Hex): Hex {
  return keccak256(seed);
}

/**
 * finalRandomness = keccak256(abi.encodePacked(seed, blockhash(revealBlock), drawId)).
 * revealBlock is the block before the reveal transaction. Its blockhash was
 * unknowable at commit time and at close time, which is what binds the
 * operator: the seed is chosen before a value it cannot predict enters the
 * result.
 */
export function finalRandomnessOf(seed: Hex, revealBlockHash: Hex, drawId: bigint): Hex {
  return keccak256(concat([seed, revealBlockHash, toBytes32(drawId)]));
}

/** keccak256(abi.encodePacked(finalRandomness, uint256(slot))). */
export function winnerHashOf(finalRandomness: Hex, slot: number): Hex {
  return keccak256(concat([finalRandomness, toBytes32(BigInt(slot))]));
}

/** One row of the cumulative ticket walk, for the /verify derivation display. */
export type WalkRow = { tokenId: bigint; tickets: bigint; from: bigint; to: bigint };

/** Cumulative ticket ranges in the walk order the contract uses. */
export function cumulativeWalk(racers: RacerTickets[]): WalkRow[] {
  const rows: WalkRow[] = [];
  let acc = 0n;
  for (const racer of racers) {
    if (racer.tickets === 0n) continue;
    const from = acc;
    acc += racer.tickets;
    rows.push({ tokenId: racer.tokenId, tickets: racer.tickets, from, to: acc });
  }
  return rows;
}

/**
 * Map a flat ticket index to a racer by cumulative walk, exactly like
 * DrawEngine._tokenAtCumulativeIndex: skip zero-ticket racers, accumulate,
 * return the first racer whose cumulative total passes the index.
 */
export function tokenAtCumulativeIndex(racers: RacerTickets[], index: bigint): bigint {
  let acc = 0n;
  for (const racer of racers) {
    if (racer.tickets === 0n) continue;
    acc += racer.tickets;
    if (index < acc) return racer.tokenId;
  }
  return racers.length > 0 ? racers[racers.length - 1].tokenId : 0n;
}

/**
 * Re-derive a draw's winners from the published final randomness and the
 * frozen ticket book. `racers` must be the draw's frozen racer list in the
 * order the pool recorded it (ChogPool.frozenRacers), and `totalTickets` the
 * draw's frozen total. Deterministic: same inputs, same winners, always.
 */
export function deriveWinners(
  finalRandomness: Hex,
  racers: RacerTickets[],
  totalTickets: bigint,
  winnerCount: number,
): DerivationResult {
  if (racers.length === 0 || totalTickets === 0n) return { winners: [], steps: [] };
  const n = racers.length;
  const count = Math.min(Math.max(0, winnerCount), n);
  const winners: bigint[] = [];
  const steps: DerivedWinner[] = [];
  const picked = new Set<string>();

  for (let i = 0; i < count; i++) {
    const h = winnerHashOf(finalRandomness, i);
    const index = BigInt(h) % totalTickets;
    let tokenId = tokenAtCumulativeIndex(racers, index);
    let walked = false;

    if (picked.has(tokenId.toString())) {
      walked = true;
      // Deterministic forward walk, same shape as the contract:
      // racers[(uint256(h) + k) % n] for k = 0..n-1, first unpicked wins.
      for (let k = 0; k < n; k++) {
        const cand = racers[Number((BigInt(h) + BigInt(k)) % BigInt(n))].tokenId;
        if (!picked.has(cand.toString())) {
          tokenId = cand;
          break;
        }
      }
    }

    picked.add(tokenId.toString());
    winners.push(tokenId);
    steps.push({ slot: i, h, index, picked: tokenId, walked });
  }

  return { winners, steps };
}

/** abi.encodePacked(uint256) is the 32-byte big-endian value. */
function toBytes32(value: bigint): Hex {
  return toHex(value, { size: 32 });
}
