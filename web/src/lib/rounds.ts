// ROUND source: the deployed GameEngine, read live for the round state, plus the
// one wallet-driven write a player needs: payRevive (its Test $CHOG approve is
// part of the same flow). Reads never fake an answer: an unreadable chain is
// reported as unreadable, not as "no round". The chain has the last word on
// every write, exactly as the rest of the app.

import type { Address, Hash, WalletClient } from "viem";
import { DEPLOYED } from "../generated/addresses.gen";
import { gameEngineAbi, testChogAbi } from "./abi";
import { testnetReadClient } from "./wallet";

const engineAddress = DEPLOYED.drawEngine as Address;
const testChogAddress = DEPLOYED.testChogToken as Address;

export type RoundStateName = "none" | "open" | "closed" | "settled";

export type RoundView = {
  id: bigint;
  state: Exclude<RoundStateName, "none">;
  closesAt: bigint;
  participants: number;
};

export type RoundRead = { ok: true; round: RoundView | null } | { ok: false };

// GameEngine.RoundState: (None, Open, Closed, Settled). The contract's own
// order, never a guess: an unknown value must not be dressed up as a state.
const STATE_NAMES: readonly RoundStateName[] = ["none", "open", "closed", "settled"];

export function stateName(state: number): RoundStateName | null {
  return STATE_NAMES[state] ?? null;
}

/** The two lines a week card leads with. Pure copy, tested as such. */
export function roundHeadline(round: RoundView | null): { title: string; note: string } {
  if (round === null) {
    return {
      title: "No week opened yet",
      note: "The round engine is deployed and live on chain. The next week appears here the moment the keeper opens it.",
    };
  }
  switch (round.state) {
    case "open":
      return {
        title: `Week ${round.id.toString()} is open`,
        note: "Play now and send your run record to the keeper to record. The week closes on the timer below.",
      };
    case "closed":
      return {
        title: `Week ${round.id.toString()} is locked`,
        note: "Runs are in. Settlement pays the top 3 on chain.",
      };
    case "settled":
      return {
        title: `Week ${round.id.toString()} is settled`,
        note: "Winners were paid and the placings are on the all-time board.",
      };
  }
}

/** What the chain says about the newest round. `round: null` means none was ever opened. */
export async function readRound(): Promise<RoundRead> {
  try {
    const id = (await testnetReadClient.readContract({
      address: engineAddress,
      abi: gameEngineAbi,
      functionName: "latestRoundId",
    })) as bigint;
    if (id === 0n) return { ok: true, round: null };
    const [state, closesAt, participants] = await Promise.all([
      testnetReadClient.readContract({
        address: engineAddress,
        abi: gameEngineAbi,
        functionName: "roundState",
        args: [id],
      }) as Promise<number>,
      testnetReadClient.readContract({
        address: engineAddress,
        abi: gameEngineAbi,
        functionName: "roundClosesAt",
        args: [id],
      }) as Promise<bigint>,
      testnetReadClient.readContract({
        address: engineAddress,
        abi: gameEngineAbi,
        functionName: "participantCount",
        args: [id],
      }) as Promise<number>,
    ]);
    const name = stateName(Number(state));
    if (name === null || name === "none") return { ok: false };
    return {
      ok: true,
      round: { id, state: name, closesAt: BigInt(closesAt), participants: Number(participants) },
    };
  } catch {
    return { ok: false };
  }
}

export type ReviveStatus = { used: boolean; fee: bigint; balance: bigint };

/** Whether THIS Chog already took its revive this round, and what it costs. */
export async function readReviveStatus(
  roundId: bigint,
  tokenId: bigint,
  account: Address,
): Promise<ReviveStatus | null> {
  try {
    const [used, fee, balance] = await Promise.all([
      testnetReadClient.readContract({
        address: engineAddress,
        abi: gameEngineAbi,
        functionName: "reviveUsed",
        args: [roundId, tokenId],
      }) as Promise<boolean>,
      testnetReadClient.readContract({
        address: engineAddress,
        abi: gameEngineAbi,
        functionName: "reviveFee",
      }) as Promise<bigint>,
      testnetReadClient.readContract({
        address: testChogAddress,
        abi: testChogAbi,
        functionName: "balanceOf",
        args: [account],
      }) as Promise<bigint>,
    ]);
    return { used: Boolean(used), fee: fee as bigint, balance: balance as bigint };
  } catch {
    return null;
  }
}

/**
 * The revive write, in the shape the wallet hook's runTx tracks: approve exactly
 * the fee, wait for the approve to land, then payRevive and hand the final hash
 * back for receipt tracking. The fee is read from the contract, never typed in
 * here. A failure at any step is reported as failure; nothing is claimed sent
 * until the wallet actually sent it.
 */
export async function sendPayRevive(
  walletClient: WalletClient,
  account: Address,
  roundId: bigint,
  tokenId: bigint,
): Promise<{ ok: true; hash: Hash; detail: string } | { ok: false; error: string }> {
  try {
    const fee = (await testnetReadClient.readContract({
      address: engineAddress,
      abi: gameEngineAbi,
      functionName: "reviveFee",
    })) as bigint;

    const allowance = (await testnetReadClient.readContract({
      address: testChogAddress,
      abi: testChogAbi,
      functionName: "allowance",
      args: [account, engineAddress],
    })) as bigint;

    if (allowance < fee) {
      const approveHash = await walletClient.writeContract({
        address: testChogAddress,
        abi: testChogAbi,
        functionName: "approve",
        args: [engineAddress, fee],
        account,
        chain: null,
      });
      await testnetReadClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const hash = await walletClient.writeContract({
      address: engineAddress,
      abi: gameEngineAbi,
      functionName: "payRevive",
      args: [roundId, tokenId],
      account,
      chain: null,
    });
    return {
      ok: true,
      hash,
      detail: `Revive fee for Chog #${tokenId.toString()} in round ${roundId.toString()}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The revive transaction did not go through.",
    };
  }
}
