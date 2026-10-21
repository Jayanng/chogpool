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
import { rankRuns, standingsNote, type RankedBoard, type StandingRow } from "./rank.js";
import { testnetReadClient } from "./wallet";

export type { RankedBoard, StandingRow };
export { rankRuns, standingsNote };
/** The shape the standings UI holds. Same fields as the shared board. */
export type WeekStandings = RankedBoard;

const engineAddress = DEPLOYED.drawEngine as Address;

const CHUNK = 100n;
const MAX_CHUNKS = 60; // the reader's window: 6,000 blocks back, about 20 hours

const scoreRecordedItem = parseAbiItem(
  "event ScoreRecorded(uint256 indexed roundId, uint256 indexed tokenId, uint256 score, uint256 coins, bool revived, address submittedBy, uint256 coinPayout)",
);
const roundOpenedItem = parseAbiItem(
  "event RoundOpened(uint256 indexed roundId, bytes32 courseSeed, uint64 closesAt)",
);

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
