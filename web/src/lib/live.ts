// LIVE game source: read-only against the deployed ChogPool (testnet) for the
// game reads, plus the one wallet-driven write the deposit dashboard needs:
// withdrawAll. The single on-chain source for the countdown (nextDrawAt), the
// pot (potBalance), per-Chog books (depositOf), time-weighted balances
// (twabOf) and live odds (oddsBpsOf). All addresses come from the generated
// module, and every method mirrors IChogPool exactly.
//
// Writes go through the connected browser wallet and the chain always has the
// last word: this module reports what the wallet sent and what the chain
// answered, never a simulated outcome.

import type { Address } from "viem";
import { CHAIN, DEPLOYED } from "../generated/addresses.gen";
import { connectWallet, switchToTestnet, testnetReadClient } from "./wallet";
import type { GameSource } from "../types/game";

const poolAbi = [
  { type: "function", name: "nextDrawAt", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "potBalance", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function",
    name: "depositOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "depositor", type: "address" },
      { name: "shares", type: "uint256" },
      { name: "principal", type: "uint256" },
    ],
  },
  { type: "function", name: "twabOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "oddsBpsOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "withdrawAll", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [] },
] as const;

const poolAddress = DEPLOYED.pool as Address;

// null when infra/deployments.json has no deployment: the app must build and
// run honestly without a pool instead of pointing at a zero address.
export const liveGameSource: GameSource | null = DEPLOYED
  ? {
      kind: "live",
      sentinel: "", // non-empty only in dev fixtures (fixture checker scans for it)
      async nextDrawAt() {
        const at = await testnetReadClient.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "nextDrawAt",
        });
        return at === 0n ? null : Number(at); // contract semantics: 0 = no draw scheduled
      },
      async potBalance() {
        return testnetReadClient.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "potBalance",
        });
      },
      async depositOf(tokenId) {
        const position = await testnetReadClient.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "depositOf",
          args: [tokenId],
        });
        return position[1]; // IChogPool.depositOf: (depositor, shares, principal)
      },
      async twabOf(tokenId) {
        return testnetReadClient.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "twabOf",
          args: [tokenId],
        });
      },
      async oddsBpsOf(tokenId) {
        return testnetReadClient.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: "oddsBpsOf",
          args: [tokenId],
        });
      },
      async deposit() {
        return {
          status: "error",
          detail: "This build does not send deposit transactions yet. Nothing moves until it does.",
        };
      },
      async withdrawAll(tokenId) {
        try {
          const { address, chainId, walletClient } = await connectWallet();
          if (chainId !== CHAIN.monadTestnet.id) await switchToTestnet(walletClient);
          const hash = await walletClient.writeContract({
            address: poolAddress,
            abi: poolAbi,
            functionName: "withdrawAll",
            args: [tokenId],
            account: address,
            chain: null,
          });
          return {
            status: "sent",
            detail: `Withdraw-all for Chog #${tokenId.toString()} sent. Transaction ${hash}.`,
          };
        } catch (error) {
          return {
            status: "error",
            detail: error instanceof Error ? error.message : "The withdraw-all transaction did not go through.",
          };
        }
      },
    }
  : null;
