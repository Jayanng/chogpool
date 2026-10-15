// LIVE game source: read-only against the deployed ChogPool (testnet) — the
// single on-chain source for the countdown (nextDrawAt), the pot (potBalance)
// and per-Chog books (depositOf). All addresses come from the generated module.
//
// Scope honesty (PLAN.md phases): this source NEVER writes. Wallet-driven
// deposit/withdraw transactions are the Phase 4 money path. `deposit()` below
// exists only to satisfy the frozen GameSource shape and always answers with
// that boundary — the UI never offers it as an action.

import type { Address } from "viem";
import { DEPLOYED } from "../generated/addresses.gen";
import { testnetReadClient } from "./wallet";
import type { GameSource } from "../types/game";

const poolAbi = [
  { type: "function", name: "nextDrawAt", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "potBalance", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "depositOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

// null when infra/deployments.json has no deployment: the app must build and
// run honestly without a pool instead of pointing at a zero address.
export const liveGameSource: GameSource | null = DEPLOYED
  ? {
      kind: "live",
      sentinel: "", // non-empty only in dev fixtures (fixture checker scans for it)
      async nextDrawAt() {
        const at = await testnetReadClient.readContract({
          address: DEPLOYED.pool as Address,
          abi: poolAbi,
          functionName: "nextDrawAt",
        });
        return at === 0n ? null : Number(at); // contract semantics: 0 = no draw scheduled
      },
      async potBalance() {
        return testnetReadClient.readContract({
          address: DEPLOYED.pool as Address,
          abi: poolAbi,
          functionName: "potBalance",
        });
      },
      async depositOf(tokenId) {
        return testnetReadClient.readContract({
          address: DEPLOYED.pool as Address,
          abi: poolAbi,
          functionName: "depositOf",
          args: [tokenId],
        });
      },
      async deposit() {
        return {
          status: "error",
          detail:
            "On-chain deposits open with the Phase 4 money path (approve → deposit). Walk the visual flow today with VITE_FIXTURES=1.",
        };
      },
    }
  : null;
