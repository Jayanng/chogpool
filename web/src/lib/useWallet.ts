// The wallet connection every Phase 4 flow shares. One source of truth for
// "who is connected, to which chain, with what balance", so no page re-invents
// connection state or disagrees with the others about it.
//
// Rules this holds to:
//  - Never claim a write succeeded before it is mined. The pending state is
//    visible and distinct from confirmed.
//  - Never imply a chain we are not on. Wrong network is a blocking state with
//    a switch button, not a warning that still lets the user click.
//  - Read failures never block the connect button; they degrade the balances.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hash, WalletClient } from "viem";
import { CHAIN, DEPLOYED } from "../generated/addresses.gen";
import { connectWallet, detectWallet, onWalletChange, switchToTestnet, testnetReadClient, type WalletState } from "./wallet";
import {
  readAllowance,
  readQuoteBalance,
  readStableFaucetReadyAt,
  readTestChogBalance,
  readTestChogReadyAt,
  readUsdcBalance,
} from "./money";

export type TxStage = "idle" | "pending" | "confirmed" | "failed";

export type MoneyBalances = {
  usdc: bigint | null;
  quote: bigint | null;
  testChog: bigint | null;
  allowance: bigint | null;
  stableFaucetReadyAt: number | null;
  testChogReadyAt: number | null;
};

const EMPTY_BALANCES: MoneyBalances = {
  usdc: null,
  quote: null,
  testChog: null,
  allowance: null,
  stableFaucetReadyAt: null,
  testChogReadyAt: null,
};

export function useWallet() {
  const [state, setState] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [balances, setBalances] = useState<MoneyBalances>(EMPTY_BALANCES);
  const [reading, setReading] = useState(false);

  const [txStage, setTxStage] = useState<TxStage>("idle");
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const walletPresent = useMemo(() => detectWallet().present, []);
  const onWrongChain = state !== null && state.chainId !== CHAIN.monadTestnet.id;
  const deployed = DEPLOYED !== null;

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      setState(await connectWallet());
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : String(error));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setState(null);
    setBalances(EMPTY_BALANCES);
    setTxStage("idle");
    setTxHash(null);
    setTxError(null);
  }, []);

  // Wallet-side account or chain changes: re-read rather than trust stale state.
  useEffect(() => onWalletChange(() => { void connect(); }), [connect]);

  const refresh = useCallback(async () => {
    if (!state) {
      setBalances(EMPTY_BALANCES);
      return;
    }
    setReading(true);
    // Reads go through the shared public client: a wallet client cannot
    // read, and routing reads through the wallet would make every balance
    // depend on the wallet being on the right chain.
    const client = testnetReadClient;
    const account: Address = state.address;
    try {
      const [usdc, quote, testChog, allowance, stableReady, testChogReady] = await Promise.all([
        readUsdcBalance(client, account).catch(() => null),
        readQuoteBalance(client, account).catch(() => null),
        readTestChogBalance(client, account).catch(() => null),
        readAllowance(client, account).catch(() => null),
        readStableFaucetReadyAt(client, account).catch(() => null),
        readTestChogReadyAt(client, account).catch(() => null),
      ]);
      setBalances({ usdc, quote, testChog, allowance, stableFaucetReadyAt: stableReady, testChogReadyAt: testChogReady });
    } finally {
      setReading(false);
    }
  }, [state]);

  useEffect(() => { void refresh(); }, [refresh]);

  /**
   * Runs one write and tracks it to confirmation. A successful broadcast is not
   * success: the stage stays `pending` until the receipt is in, so the UI can
   * never tell a user something settled that has not.
   */
  const runTx = useCallback(
    async (write: (walletClient: WalletClient, account: Address) => Promise<{ ok: true; hash: Hash; detail: string } | { ok: false; error: string }>, onConfirmed?: () => void | Promise<void>) => {
      if (!state) {
        setTxError("Connect a wallet first.");
        setTxStage("failed");
        return false;
      }
      setTxStage("pending");
      setTxHash(null);
      setTxError(null);
      const result = await write(state.walletClient, state.address);
      if (!result.ok) {
        setTxStage("failed");
        setTxError(result.error);
        return false;
      }
      setTxHash(result.hash);
      try {
        const receipt = await testnetReadClient.waitForTransactionReceipt({ hash: result.hash });
        if (receipt.status !== "success") {
          setTxStage("failed");
          setTxError("The transaction was mined but reverted. Nothing changed on chain.");
          return false;
        }
        setTxStage("confirmed");
        if (onConfirmed) await onConfirmed();
        return true;
      } catch (error) {
        // A dropped or unseen receipt is not a failure: the tx may still land.
        setTxStage("idle");
        setTxError("Sent, but confirmation was not observed. Check the explorer link before retrying.");
        setTxHash(result.hash);
        return false;
      }
    },
    [state],
  );

  const switchNetwork = useCallback(async () => {
    if (!state) return;
    await switchToTestnet(state.walletClient);
    await connect();
  }, [state, connect]);

  const resetTx = useCallback(() => {
    setTxStage("idle");
    setTxHash(null);
    setTxError(null);
  }, []);

  return {
    address: state?.address ?? null,
    walletClient: state?.walletClient ?? null,
    connected: state !== null,
    connecting,
    connectError,
    walletPresent,
    onWrongChain,
    deployed,
    balances,
    reading,
    txStage,
    txHash,
    txError,
    connect,
    disconnect,
    refresh,
    runTx,
    switchNetwork,
    resetTx,
    explorerTx: (hash: Hash) => `${CHAIN.monadTestnet.explorer}/tx/${hash}`,
  };
}

export type MoneyWallet = ReturnType<typeof useWallet>;
