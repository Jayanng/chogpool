// WEEK STANDINGS: the live score ranking for the current week, read from the
// round engine's ScoreRecorded events. Ranked by score, and honest about what
// it shows: the contract's participantCount is the truth of how many runs
// exist, and when the reader's window cannot reach the week's opening it says
// "showing X of Y" rather than pretending the list is complete.
//
// This RPC rejects getLogs over 100 blocks (HTTP 413), so the reader walks
// backwards in 100-block chunks and stops as soon as it sees the week's own
// RoundOpened event. A fresh week is a few chunks; a week older than the
// window is reported as partial.

import { type Address, parseAbiItem } from "viem";
import { DEPLOYED } from "../generated/addresses.gen";
import { testnetReadClient } from "./wallet";

const engineAddress = DEPLOYED.drawEngine as Address;

const CHUNK = 100n;
const MAX_CHUNKS = 60; // the reader's window: 6,000 blocks back, about 20 hours

const scoreRecordedItem = parseAbiItem(
  "event ScoreRecorded(uint256 indexed roundId, uint256 indexed tokenId, uint256 score, uint256 coins, bool revived, address submittedBy, uint256 coinPayout)",
);
const roundOpenedItem = parseAbiItem(
  "event RoundOpened(uint256 indexed roundId, bytes32 courseSeed, uint64 closesAt)",
);

export type StandingRow = {
  tokenId: bigint;
  score: bigint;
  coins: bigint;
  revived: boolean;
};

export type WeekStandings = {
  rows: StandingRow[];
  /** participantCount from the contract: how many runs are recorded on chain */
  recorded: number;
  /** true when the scan reached the week's opening, so rows is the full list */
  covered: boolean;
};

/** Sort by score, then tokenId. Pure and tested as such. */
export function rankRuns(rows: StandingRow[]): StandingRow[] {
  return [...rows].sort((a, b) => {
    if (a.score === b.score) return a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0;
    return a.score > b.score ? -1 : 1;
  });
}

/**
 * The one line that says what the list is. Never "full standings" when the
 * scan could not reach the week's opening.
 */
export function standingsNote(s: WeekStandings): string {
  if (s.recorded === 0) return "No runs recorded on chain for this week yet.";
  if (s.covered) return `All ${s.recorded} recorded run${s.recorded === 1 ? "" : "s"}, ranked by score.`;
  return `Showing ${s.rows.length} of ${s.recorded} recorded runs. Older runs are outside this reader's window.`;
}

export async function readWeekStandings(roundId: bigint): Promise<WeekStandings | null> {
  try {
    const recorded = Number(
      await testnetReadClient.readContract({
        address: engineAddress,
        abi: [
          {
            type: "function",
            name: "participantCount",
            stateMutability: "view",
            inputs: [{ name: "roundId", type: "uint256" }],
            outputs: [{ name: "", type: "uint32" }],
          },
        ],
        functionName: "participantCount",
        args: [roundId],
      }),
    );

    const head = await testnetReadClient.getBlockNumber();
    const byToken = new Map<string, StandingRow>();
    let covered = false;

    let to = head;
    for (let i = 0; i < MAX_CHUNKS && !covered; i++) {
      const from = to - CHUNK + 1n > 0n ? to - CHUNK + 1n : 0n;
      const [scores, opens] = await Promise.all([
        testnetReadClient.getLogs({
          address: engineAddress,
          event: scoreRecordedItem,
          args: { roundId },
          fromBlock: from,
          toBlock: to,
        }),
        testnetReadClient.getLogs({
          address: engineAddress,
          event: roundOpenedItem,
          args: { roundId },
          fromBlock: from,
          toBlock: to,
        }),
      ]);
      for (const log of scores) {
        const key = log.args.tokenId!.toString();
        byToken.set(key, {
          tokenId: log.args.tokenId!,
          score: log.args.score!,
          coins: log.args.coins!,
          revived: Boolean(log.args.revived),
        });
      }
      if (opens.length > 0) covered = true;
      if (from === 0n) covered = true;
      to = from - 1n;
      if (to < 0n) break;
    }

    return { rows: rankRuns([...byToken.values()]), recorded, covered };
  } catch {
    return null;
  }
}
