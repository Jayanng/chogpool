// The book: every Chog with a stake in the pool, read live from the chain.
//
// Honest by construction: entries come from sharesOf() on the pool contract,
// batched through Multicall3, one call per possible Chog id (1..1,969). A
// Chog is "in the book" exactly when the pool says it holds shares. Nothing
// here is cached, invented, or remembered from earlier sessions.

import { type Address, parseAbi } from "viem";
import { DEPLOYED, TESTNET } from "../generated/addresses.gen";
import { testnetReadClient } from "./wallet";
import { MAX_SUPPLY } from "./mirror";

/** Multicall3, verified live on Monad testnet (see infra/verified.json). */
const MULTICALL3 = TESTNET.multicall3 as Address;

const sharesAbi = parseAbi(["function sharesOf(uint256 tokenId) view returns (uint256)"]);

export type BookEntry = {
  tokenId: bigint;
  shares: bigint;
};

const BATCH = 400;

/** Read the whole book. Returns every Chog holding shares, biggest stake
 *  first. An empty list means the book is genuinely empty. */
export async function readBook(): Promise<BookEntry[]> {
  const pool = DEPLOYED.pool as Address;
  const entries: BookEntry[] = [];

  for (let start = 1n; start <= BigInt(MAX_SUPPLY); start += BigInt(BATCH)) {
    const end = start + BigInt(BATCH) - 1n > BigInt(MAX_SUPPLY) ? BigInt(MAX_SUPPLY) : start + BigInt(BATCH) - 1n;
    const contracts: Array<{ address: Address; abi: typeof sharesAbi; functionName: "sharesOf"; args: [bigint] }> = [];
    for (let id = start; id <= end; id++) {
      contracts.push({ address: pool, abi: sharesAbi, functionName: "sharesOf", args: [id] });
    }
    const results = await testnetReadClient.multicall({
      contracts,
      allowFailure: true,
      multicallAddress: MULTICALL3,
    });
    results.forEach((r, j) => {
      const shares = r.status === "success" ? (r.result as bigint) : 0n;
      if (shares > 0n) entries.push({ tokenId: contracts[j].args[0], shares });
    });
  }

  entries.sort((a, b) => (b.shares === a.shares ? Number(a.tokenId - b.tokenId) : b.shares > a.shares ? 1 : -1));
  return entries;
}
