// WEEK STANDINGS: the live score ranking for the current week. The browser
// does not walk logs by itself, it reads the board endpoint, which walks the
// engine's ScoreRecorded events in 100-block chunks (this RPC rejects getLogs
// over 100 blocks), caches briefly, and retries. Ranked by score, and honest
// about what it shows: the contract's participantCount is the truth of how
// many runs exist, and when the window cannot reach the week's opening the
// reader says "showing X of Y" rather than pretending the list is complete.

import { type Address } from "viem";
import { DEPLOYED } from "../generated/addresses.gen";
import { rankRuns, standingsNote, type RankedBoard, type StandingRow } from "./rank.js";

export type { RankedBoard, StandingRow };
export { rankRuns, standingsNote };
/** The shape the standings UI holds. Same fields as the shared board. */
export type WeekStandings = RankedBoard;

/**
 * What the chain says about the week's standings. The browser does NOT walk
 * logs: one call to the board endpoint, which caches and retries against the
 * rate-limited RPC. A failed read is reported as unreadable, never as empty.
 */
export async function readWeekStandings(roundId: bigint): Promise<WeekStandings | null> {
  try {
    const res = await fetch(`/api/board?round=${roundId.toString()}`);
    const body = (await res.json()) as {
      status?: string;
      rows?: Array<{ tokenId: string; score: string; coins: string; revived: boolean }>;
      recorded?: number;
      covered?: boolean;
    };
    if (!res.ok || body.status !== "board") return null;
    return {
      rows: (body.rows ?? []).map((r) => ({
        tokenId: BigInt(r.tokenId),
        score: BigInt(r.score),
        coins: BigInt(r.coins),
        revived: Boolean(r.revived),
      })),
      recorded: Number(body.recorded ?? 0),
      covered: Boolean(body.covered),
    };
  } catch {
    return null;
  }
}
