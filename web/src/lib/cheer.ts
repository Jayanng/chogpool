// Test $CHOG cheering: real ERC-20 transfers on Monad testnet, from the
// spectator's wallet to a racer's team wallet (the depositor behind the
// position). A cheer is a vote for that racer's look as well as a tip: the
// Test $CHOG lands in the team wallet the moment the transaction is mined.
//
// There is no pot contract holding anything: the token's whole surface is the
// standard ERC-20 plus a capped faucet, so a tip goes where it is sent and the
// chain is the ledger. This module reads balances and claim state through the
// shared testnet client and writes only through a connected wallet client.

import type { Address, WalletClient } from "viem";
import { DEPLOYED } from "../generated/addresses.gen";
import { testnetReadClient } from "./wallet";
import { testChogAbi } from "./abi";

const testChog = DEPLOYED.testChogToken as Address;

/** Display decimals for Test $CHOG (contract: 18). */
export const TEST_CHOG_DECIMALS = 18;

export type ClaimState = {
  claimAmount: bigint;
  claimCooldown: bigint;
  /** Unix seconds when this account may claim again, 0 when it can claim now. */
  nextClaimAt: number;
};

export async function readTestChogBalance(account: Address): Promise<bigint> {
  return testnetReadClient.readContract({
    address: testChog,
    abi: testChogAbi,
    functionName: "balanceOf",
    args: [account],
  });
}

export async function readClaimState(account: Address): Promise<ClaimState> {
  const [amount, cooldown, next] = await testnetReadClient.multicall({
    contracts: [
      { address: testChog, abi: testChogAbi, functionName: "claimAmount" },
      { address: testChog, abi: testChogAbi, functionName: "claimCooldown" },
      { address: testChog, abi: testChogAbi, functionName: "nextClaimAt", args: [account] },
    ],
  });
  return {
    claimAmount: (amount.result as bigint | undefined) ?? 0n,
    claimCooldown: (cooldown.result as bigint | undefined) ?? 0n,
    nextClaimAt: Number((next.result as bigint | undefined) ?? 0n),
  };
}

/** Claim the faucet. Returns the transaction hash once it is sent. */
export async function claimTestChog(wallet: WalletClient, account: Address): Promise<Address> {
  const hash = await wallet.writeContract({
    address: testChog,
    abi: testChogAbi,
    functionName: "claim",
    account,
    chain: wallet.chain ?? null,
  });
  return hash;
}

/**
 * Send a cheer: a real Test $CHOG transfer from the fan to the racer's team.
 * Returns the transaction hash once it is sent.
 */
export async function sendCheer(
  wallet: WalletClient,
  account: Address,
  teamWallet: Address,
  amount: bigint,
): Promise<Address> {
  const hash = await wallet.writeContract({
    address: testChog,
    abi: testChogAbi,
    functionName: "transfer",
    args: [teamWallet, amount],
    account,
    chain: wallet.chain ?? null,
  });
  return hash;
}
