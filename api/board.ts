// THE RANKED BOARD, served at /api/board. Read-only, no key anywhere: it
// walks the engine's ScoreRecorded events and returns the week's standings
// ranked exactly as the site ranks them, plus the top 3 in placement order,
// ready for settleRound. The keeper reads this at the close and settles
// straight from it. The chain remains the truth: this is a reader, and every
// number it returns can be re-derived from scoreOf on chain.

import { createPublicClient, http, parseAbi, parseAbiItem, type Abi } from "viem";
import { DEPLOYED } from "./_gen/generated/addresses.gen.js";
import { rankRuns, standingsNote, type StandingRow } from "./_gen/lib/rank.js";

const RPC = "https://testnet-rpc.monad.xyz";
const engineAddress = DEPLOYED.drawEngine as `0x${string}`;

const CHUNK = 100n; // this RPC rejects getLogs over 100 blocks (HTTP 413)
const MAX_CHUNKS = 60;

const engineAbi = parseAbi([
  "function latestRoundId() view returns (uint256)",
  "function participantCount(uint256 roundId) view returns (uint32)",
]) as Abi;

const scoreRecordedItem = parseAbiItem(
  "event ScoreRecorded(uint256 indexed roundId, uint256 indexed tokenId, uint256 score, uint256 coins, bool revived, address submittedBy, uint256 coinPayout)",
);
const roundOpenedItem = parseAbiItem(
  "event RoundOpened(uint256 indexed roundId, bytes32 courseSeed, uint64 closesAt)",
);

type Req = { method?: string; query?: Record<string, string | undefined> };
type Res = { status: (code: number) => Res; json: (payload: unknown) => void };

declare const process: { env: Record<string, string | undefined> };

const publicClient = createPublicClient({ transport: http(RPC) });

export default async function handler(req: Req, res: Res) {
  if ((req.method ?? "GET") !== "GET") {
    return res.status(405).json({ status: "rejected", detail: "GET the ranked board." });
  }

  try {
    let roundId = BigInt(req.query?.round ?? "0");
    if (roundId === 0n) {
      roundId = (await publicClient.readContract({
        address: engineAddress,
        abi: engineAbi,
        functionName: "latestRoundId",
      })) as bigint;
    }
    if (roundId === 0n) {
      return res.status(200).json({ status: "no-week", detail: "No week is open on chain yet." });
    }

    const recorded = Number(
      await publicClient.readContract({
        address: engineAddress,
        abi: engineAbi,
        functionName: "participantCount",
        args: [roundId],
      }),
    );

    const head = await publicClient.getBlockNumber();
    const byToken = new Map<string, StandingRow>();
    let covered = false;
    let to = head;
    for (let i = 0; i < MAX_CHUNKS && !covered; i++) {
      const from = to - CHUNK + 1n > 0n ? to - CHUNK + 1n : 0n;
      const [scores, opens] = await Promise.all([
        publicClient.getLogs({
          address: engineAddress,
          event: scoreRecordedItem,
          args: { roundId },
          fromBlock: from,
          toBlock: to,
        }),
        publicClient.getLogs({
          address: engineAddress,
          event: roundOpenedItem,
          args: { roundId },
          fromBlock: from,
          toBlock: to,
        }),
      ]);
      for (const log of scores) {
        byToken.set(log.args.tokenId!.toString(), {
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

    const rows = rankRuns([...byToken.values()]);
    const board = { rows, recorded, covered };
    return res.status(200).json({
      status: "board",
      roundId: roundId.toString(),
      recorded,
      covered,
      note: standingsNote(board),
      rows: rows.map((r) => ({
        tokenId: r.tokenId.toString(),
        score: r.score.toString(),
        coins: r.coins.toString(),
        revived: r.revived,
      })),
      // Placement order for settleRound: first, second, third. Empty slots
      // when fewer than three runs exist; settleRound refuses a zero tokenId,
      // so the keeper must not settle a week with under three runs.
      top3: rows.slice(0, 3).map((r) => r.tokenId.toString()),
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      detail: error instanceof Error ? error.message.slice(0, 900) : "The board could not be read.",
    });
  }
}
