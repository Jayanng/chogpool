// THE LEADERBOARD's on-chain source: the CareerStore's placement records.
// The podium of the latest race is found by reading every Chog's placement
// for it through Multicall3 and taking the recorded 1st, 2nd and 3rd. No
// page invents a row: a placement the store has not recorded is simply not
// on the board.

import { type Address, parseAbi } from "viem";
import { DEPLOYED, TESTNET } from "../generated/addresses.gen";
import { testnetReadClient } from "./wallet";
import { readCurrentDrawId } from "./draw";

const MULTICALL3 = TESTNET.multicall3 as Address;
const MAX_SUPPLY = 1969;

const placementAbi = parseAbi(["function placementOf(uint256 tokenId, uint256 raceId) view returns (uint8)"]);

export type PodiumRow = {
  place: number;
  tokenId: bigint;
};

/** Pure: turn per-Chog placement reads into the podium, in placement order.
 *  A placement the store has not recorded (0 or a failed read) is skipped,
 *  never guessed. Two rows never share a place. */
export function podiumOf(entries: Array<{ tokenId: bigint; placement: number | null }>): PodiumRow[] {
  const rows: PodiumRow[] = [];
  for (const place of [1, 2, 3]) {
    const hit = entries.find((e) => e.placement === place);
    if (hit) rows.push({ place, tokenId: hit.tokenId });
  }
  return rows;
}

const BATCH = 400;

/** The latest race's podium, read live from the CareerStore. */
export async function readPodium(): Promise<PodiumRow[]> {
  const raceId = await readCurrentDrawId();
  if (raceId === null) return [];
  const store = DEPLOYED.careerStore as Address;

  const entries: Array<{ tokenId: bigint; placement: number | null }> = [];
  for (let start = 1n; start <= BigInt(MAX_SUPPLY); start += BigInt(BATCH)) {
    const end = start + BigInt(BATCH) - 1n > BigInt(MAX_SUPPLY) ? BigInt(MAX_SUPPLY) : start + BigInt(BATCH) - 1n;
    const contracts: Array<{ address: Address; abi: typeof placementAbi; functionName: "placementOf"; args: [bigint, bigint] }> = [];
    const ids: bigint[] = [];
    for (let id = start; id <= end; id++) {
      ids.push(id);
      contracts.push({ address: store, abi: placementAbi, functionName: "placementOf", args: [id, raceId] });
    }
    const results = await testnetReadClient.multicall({
      contracts,
      allowFailure: true,
      multicallAddress: MULTICALL3,
    });
    results.forEach((r, i) => {
      entries.push({
        tokenId: ids[i],
        placement: r.status === "success" ? Number(r.result as number) : null,
      });
    });
  }

  return podiumOf(entries);
}
