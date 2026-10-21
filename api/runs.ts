// THE RECORDER. A finished run arrives here, is re-derived through the same
// pure simulation the Proof page uses, and only a run whose numbers recompute
// is submitted on chain. That is the anti-cheat: this endpoint is open to
// anyone, but a forged record fails its own tape and never reaches the
// contract. The signing key is the game authority and nothing else: it cannot
// move funds, cannot settle, cannot re-point the pool. If it leaks, the worst
// case is an unearned score, exactly the trust the authority model already
// carries, now automated.

import { createPublicClient, createWalletClient, http, parseAbi, type Abi, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, DEPLOYED } from "./_gen/generated/addresses.gen.js";
import { verifyRunRecord } from "./_gen/game/runRecord.js";
import { parseSubmission } from "./_gen/lib/submit.js";

const RPC = "https://testnet-rpc.monad.xyz";

// The wallet client MUST carry the chain. With `chain: null` the signed
// transaction goes out without a chain id and the RPC rejects it as invalid
// params before it is ever a transaction. The chain id comes from the
// registry, never a literal.
const chain = {
  id: CHAIN.monadTestnet.id,
  name: CHAIN.monadTestnet.name,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.monadTestnet.rpc] } },
  blockExplorers: { default: { name: "MonadScan", url: CHAIN.monadTestnet.explorer } },
} as unknown as Chain;

const engineAddress = DEPLOYED.drawEngine as `0x${string}`;
const poolAddress = DEPLOYED.pool as `0x${string}`;

const engineAbi = parseAbi([
  "function latestRoundId() view returns (uint256)",
  "function roundState(uint256 roundId) view returns (uint8)",
  "function hasRun(uint256 roundId, uint256 tokenId) view returns (bool)",
  "function scoreOf(uint256 roundId, uint256 tokenId) view returns (uint256)",
  "function gameAuthority() view returns (address)",
  "function submitScores(uint256 roundId, uint256[] tokenIds, uint256[] scores, uint256[] coins, bool[] revived)",
]) as Abi;
const poolAbi = parseAbi(["function sharesOf(uint256 tokenId) view returns (uint256)"]) as Abi;

type Req = { method?: string; body?: unknown };
type Res = { status: (code: number) => Res; json: (payload: unknown) => void };

// The only Node surface this function uses. Declared here rather than pulling
// @types/node: the function builder installs production dependencies only, and
// a missing type library aborts its compile.
declare const process: { env: Record<string, string | undefined> };

const publicClient = createPublicClient({ transport: http(RPC) });

export default async function handler(req: Req, res: Res) {
  if ((req.method ?? "GET") !== "POST") {
    return res.status(405).json({ status: "rejected", detail: "POST a run record." });
  }

  const parsed = parseSubmission(req.body);
  if (!parsed.ok) return res.status(400).json({ status: "rejected", detail: parsed.error });
  const { tokenId, record } = parsed;

  // The same re-derivation the Proof page runs. A record that does not
  // recompute is refused here, on the server, before any key is used.
  const check = verifyRunRecord(record);
  if (!check.ok) {
    const failed = check.checks
      .filter((c) => !c.ok)
      .map((c) => `${c.label}: ${c.detail}`)
      .join(" / ");
    return res.status(400).json({
      status: "rejected",
      detail: `The run record did not re-derive. ${failed}`,
    });
  }

  const key = process.env.GAME_AUTHORITY_KEY;
  if (!key) {
    return res.status(503).json({
      status: "error",
      detail: "The recorder has no key configured. Copy the run record to the keeper meanwhile.",
    });
  }

  try {
    const roundId = (await publicClient.readContract({
      address: engineAddress,
      abi: engineAbi,
      functionName: "latestRoundId",
    })) as bigint;
    if (roundId === 0n) {
      return res.status(409).json({
        status: "rejected",
        detail: "No week is open on chain yet. Hold the run record until the keeper opens one.",
      });
    }

    const state = Number(
      await publicClient.readContract({
        address: engineAddress,
        abi: engineAbi,
        functionName: "roundState",
        args: [roundId],
      }),
    );
    if (state !== 1 && state !== 2) {
      return res.status(409).json({
        status: "rejected",
        detail: "This week is locked for recording. Your run ranks next week.",
      });
    }

    const shares = (await publicClient.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "sharesOf",
      args: [tokenId],
    })) as bigint;
    if (shares === 0n) {
      return res.status(400).json({
        status: "rejected",
        detail: `Chog #${tokenId.toString()} has no position in the pool. Deposit first.`,
      });
    }

    const already = (await publicClient.readContract({
      address: engineAddress,
      abi: engineAbi,
      functionName: "hasRun",
      args: [roundId, tokenId],
    })) as boolean;
    if (already) {
      // Best run counts. The contract replaces an entry only when the new
      // score is strictly higher, so a worse run is skipped here rather than
      // sent up to be refused.
      const current = (await publicClient.readContract({
        address: engineAddress,
        abi: engineAbi,
        functionName: "scoreOf",
        args: [roundId, tokenId],
      })) as bigint;
      if (BigInt(record.claimed.score) <= current) {
        return res.status(200).json({
          status: "already",
          detail: `Chog #${tokenId.toString()} is on this week's board with a better score (${current.toString()}). This run did not replace it.`,
        });
      }
    }

    const account = privateKeyToAccount(key as `0x${string}`);
    const walletClient = createWalletClient({ account, chain, transport: http(RPC) });
    const hash = await walletClient.writeContract({
      address: engineAddress,
      abi: engineAbi,
      functionName: "submitScores",
      args: [
        roundId,
        [tokenId],
        [BigInt(record.claimed.score)],
        [BigInt(record.claimed.coins)],
        [record.claimed.revived],
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    return res.status(200).json({
      status: "recorded",
      tx: hash,
      detail: `Run recorded on chain for Chog #${tokenId.toString()}. It ranks on the board now.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("NotGameAuthority")) {
      return res.status(409).json({
        status: "rejected",
        detail: "The recorder is not authorized on chain yet. Copy the run record to the keeper meanwhile.",
      });
    }
    return res.status(500).json({
      status: "error",
      detail: `The chain refused the submission. ${message.slice(0, 200)}`,
    });
  }
}
