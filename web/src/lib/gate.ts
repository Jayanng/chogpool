// The entry gate: a Chog opens the app. No Chog, no app.
//
// Both checks read the chain and nothing else: a real Chog on Monad mainnet
// (one ERC-721 balanceOf), or a Test Drive already minted on testnet
// (mirror.hasTestDrive). A read that does not answer keeps the gate shut; it is
// never treated as a pass. This is UI access only: the contracts themselves are
// bound to a Chog at the deposit layer.

import { useCallback, useEffect, useRef, useState } from "react";
import { type Address } from "viem";
import { DEPLOYED } from "../generated/addresses.gen";
import { mirrorAbi } from "./abi";
import { ownsRealChog } from "./chog";
import { testnetReadClient } from "./wallet";

/** The official, verified Chog marketplace: OpenSea's "Chog Genesis" (Verified)
 *  collection, contract 0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763, matching
 *  MAINNET.chogGenesisNFT exactly. This is a footnote for real buyers, never the
 *  way in: the door is minting a Test Chog right here in the app. */
export const CHOG_MARKETPLACE_URL = "https://opensea.io/collection/chog-genesis";

export type GateState = "checking" | "in" | "blocked";

/** Does this account clear the gate: a real Chog on mainnet, or a Test Drive
 *  already minted on testnet? */
export async function checkGate(account: Address): Promise<boolean> {
  const [real, hasTest] = await Promise.all([
    ownsRealChog(account),
    testnetReadClient
      .readContract({ address: DEPLOYED.mirror as Address, abi: mirrorAbi, functionName: "hasTestDrive", args: [account] })
      .then((v) => v === true)
      .catch(() => false),
  ]);
  return real || hasTest;
}

/**
 * Watches one account and reports whether it is through the gate. Re-checks on a
 *  slow timer so that minting a Test Drive on the mint page opens the app on its
 *  own, without a manual refresh. Only the latest check may set state.
 */
export function useGate(account: Address | undefined): GateState {
  const [state, setState] = useState<GateState>("checking");
  const seq = useRef(0);

  const run = useCallback(() => {
    if (!account) return;
    const ticket = ++seq.current;
    checkGate(account)
      .then((ok) => {
        if (ticket === seq.current) setState(ok ? "in" : "blocked");
      })
      .catch(() => {
        if (ticket === seq.current) setState("blocked");
      });
  }, [account]);

  useEffect(() => {
    // A new account starts at "checking" and never inherits the last account's
    // "in": switching from a holder to a non-holder must not leave the gate open
    // while the new check is in flight. Bumping the sequence also drops any check
    // still running for the old account, including one that would land after a
    // disconnect, and stops a late setState after unmount.
    seq.current += 1;
    setState("checking");
    run();
    if (!account) return;
    const id = window.setInterval(run, 20000);
    return () => {
      seq.current += 1;
      window.clearInterval(id);
    };
  }, [run, account]);

  return state;
}
