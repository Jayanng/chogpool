// /tips: Test CHOG tips. Play money, labelled as play money everywhere.
//
// The token is called "Test CHOG" in both name and symbol on-chain precisely so
// it can never be mistaken for the real mainnet $CHOG. This page keeps that
// distinction visible next to the user's real balance: the real $CHOG address
// is shown as a read-only reference, never as something this page can move.
//
// A tip is a plain ERC-20 transfer. There is no cleverness here and none is
// claimed: the page says what the token is, what the cooldown is, and what the
// transfer does.

import { useEffect, useMemo, useState } from "react";
import { type Address, isAddress } from "viem";
import { Badge, Button, Card, Panel, Stat, Toast } from "@chogpool/ui";
import { useWallet } from "../lib/useWallet";
import { busyStates } from "../lib/tx-pending";
import {
  TEST_CHOG_DECIMALS,
  claimTestChog,
  cooldownLabel,
  formatTestChog,
  parseTestChog,
  tipTestChog,
} from "../lib/money";
import { testnetReadClient } from "../lib/wallet";
import { DEPLOYED, MAINNET } from "../generated/addresses.gen";
import { shortAddress } from "../lib/wallet";
import { navigate } from "../lib/router";

const chogAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "claimAmount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "claimCooldown", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "nextClaimAt", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "testLabel", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

const token = () => DEPLOYED.testChogToken as Address;

type TokenState = {
  /** The connected wallet's balance. Null when no wallet is connected: the
   *  balance is unknown then, never zero. */
  balance: bigint | null;
  claimAmount: bigint;
  claimCooldown: bigint;
  /** Unix seconds the connected wallet may claim again. Null with no wallet. */
  nextClaimAt: number | null;
  testLabel: string;
  totalSupply: bigint;
};

// Each tips page action, for per-button pending tracking. One action in flight
// marks only its own button; the other keeps its label and stays usable.
const TIP_ACTIONS = ["claim", "tip"] as const;
type TipAction = (typeof TIP_ACTIONS)[number];

export default function Tips() {
  const wallet = useWallet();
  const [state, setState] = useState<TokenState | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [to, setTo] = useState("");
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  // Which action is in flight, so only its own button says "Sending...".
  const [pending, setPending] = useState<TipAction | null>(null);

  useEffect(() => {
    if (!DEPLOYED) {
      setState(null);
      return;
    }
    setReadFailed(false);
    void (async () => {
      try {
        // The faucet size and the supply are plain token reads: they answer
        // with no wallet connected. Only the two account reads wait for an
        // address, and they stay null without one (unknown, not zero).
        const [claimAmount, claimCooldown, testLabel, totalSupply] = await Promise.all([
          testnetReadClient.readContract({ address: token(), abi: chogAbi, functionName: "claimAmount" }),
          testnetReadClient.readContract({ address: token(), abi: chogAbi, functionName: "claimCooldown" }),
          testnetReadClient.readContract({ address: token(), abi: chogAbi, functionName: "testLabel" }),
          testnetReadClient.readContract({ address: token(), abi: chogAbi, functionName: "totalSupply" }),
        ]);
        let balance: bigint | null = null;
        let nextClaimAt: number | null = null;
        if (wallet.address) {
          const [held, next] = await Promise.all([
            testnetReadClient.readContract({ address: token(), abi: chogAbi, functionName: "balanceOf", args: [wallet.address as Address] }),
            testnetReadClient.readContract({ address: token(), abi: chogAbi, functionName: "nextClaimAt", args: [wallet.address as Address] }),
          ]);
          balance = held;
          nextClaimAt = Number(next);
        }
        setState({ balance, claimAmount, claimCooldown, nextClaimAt, testLabel, totalSupply });
      } catch {
        setReadFailed(true);
        setState(null);
      }
    })();
  }, [wallet.address, wallet.txStage]);

  const recipient = useMemo(() => (isAddress(to.trim()) ? (to.trim() as Address) : null), [to]);
  const amount = useMemo(() => parseTestChog(amountText), [amountText]);

  const now = Math.floor(Date.now() / 1000);
  const onCooldown = state !== null && state.nextClaimAt !== null && state.nextClaimAt > now;
  const balance = state?.balance ?? null;
  // Unknown is not zero: with no wallet (or no answer) the page says so and
  // checks nothing against a balance it does not have.
  const balanceLabel = !wallet.address
    ? "connect a wallet to see your balance"
    : balance !== null
      ? `${formatTestChog(balance)} Test CHOG`
      : readFailed
        ? "this read did not answer on this RPC"
        : "…";
  const tooMuch = amount !== null && balance !== null && amount > balance;
  const canTip = recipient !== null && amount !== null && amount > 0n && !tooMuch && wallet.connected && !wallet.onWrongChain;

  async function claim() {
    setNote(null);
    setPending("claim");
    try {
      const ok = await wallet.runTx(claimTestChog, () => setNote("Claimed Test CHOG. Spend it on tips."), "Claimed Test CHOG");
      if (ok) void wallet.refresh();
    } finally {
      setPending(null);
    }
  }

  async function tip() {
    if (recipient === null || amount === null) return;
    setNote(null);
    setPending("tip");
    try {
      const ok = await wallet.runTx(
        (walletClient, account) => tipTestChog(walletClient, account, recipient, amount),
        () => setNote(`Tipped ${formatTestChog(amount)} Test CHOG to ${shortAddress(recipient)}.`),
        `Tipped ${formatTestChog(amount)} Test CHOG to ${shortAddress(recipient)}`,
      );
      if (ok) {
        void wallet.refresh();
        setTo("");
        setAmountText("");
      }
    } finally {
      setPending(null);
    }
  }

  // Each button is busy only while its own action is in flight.
  const busy = busyStates(pending, TIP_ACTIONS);

  return (
    <>
      <section className="page-head">
        <p className="kicker">TEST CHOG TIPS</p>
        <h1>Cheer with<br /><em>play money.</em></h1>
        <p className="lede">
          Tip your favourite racers in Test CHOG, a real ERC-20 on testnet that exists only for
          the fun layers. It is named "Test CHOG" on-chain in both name and symbol, so it can
          never be confused with the real mainnet $CHOG.
        </p>
        <div className="network-note"><span className="status-dot" /> Play: Monad Testnet · play money only</div>
      </section>

      <Panel className="feature-panel">
        <Card
          title="Your Test CHOG"
          aside={<Badge tone="neutral">NOT $CHOG</Badge>}
          footer="A REAL ERC-20 ON TESTNET · 18 DECIMALS · FAUCET-CAPPED PER WALLET"
        >
          <div className="stat-row">
            <Stat label="BALANCE" value={wallet.reading ? "…" : balanceLabel} tone="lime" />
            <Stat
              label="FAUCET"
              value={state ? `${formatTestChog(state.claimAmount)} per claim` : readFailed ? "this read did not answer on this RPC" : "…"}
              note={state ? `once every ${Number(state.claimCooldown) / 3600} hours` : undefined}
            />
            <Stat label="TOTAL SUPPLY" value={state ? `${formatTestChog(state.totalSupply, 0)} Test CHOG` : readFailed ? "this read did not answer on this RPC" : "…"} note="Faucet-capped, so tips stay meaningful." />
          </div>

          <div className="button-row">
            <Button onClick={() => void claim()} disabled={!wallet.connected || wallet.onWrongChain || onCooldown || busy.claim}>
              {onCooldown
                ? `Ready in ${cooldownLabel(state?.nextClaimAt ?? 0, now)}`
                : busy.claim ? "Sending…" : "Claim Test CHOG"}
            </Button>
          </div>

          {!wallet.connected && <p className="muted small">Connect a wallet on Monad Testnet to claim and tip.</p>}
          {wallet.connected && wallet.onWrongChain && <p className="muted small">Switch to Monad Testnet first.</p>}
        </Card>
      </Panel>

      {wallet.connected && !wallet.onWrongChain && (
        <Panel className="feature-panel">
          <Card
            title="Send a tip"
            aside={<Badge tone={tooMuch ? "danger" : "neutral"}>{tooMuch ? "OVER BALANCE" : "ERC-20 TRANSFER"}</Badge>}
            footer="A PLAIN TRANSFER: NO CONTRACT LOGIC, NO CLAIMED FEATURE"
          >
            <label className="field">
              <span>RECIPIENT ADDRESS</span>
              <input placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            {to.trim().length > 0 && recipient === null && (
              <p className="muted small">That is not a valid address.</p>
            )}
            <label className="field">
              <span>AMOUNT (TEST CHOG)</span>
              <input inputMode="decimal" placeholder="10.00" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            </label>
            {tooMuch && balance !== null && <p className="muted small">You hold {formatTestChog(balance)} Test CHOG. Claim more or send less.</p>}

            <div className="button-row">
              <Button onClick={() => void tip()} disabled={!canTip || busy.tip}>
                {busy.tip ? "Sending…" : "Send tip"}
              </Button>
              <Button variant="outline" onClick={() => navigate("/race")}>See the race ↗</Button>
            </div>
          </Card>
        </Panel>
      )}

      <Panel className="feature-panel">
        <Card title="Not the real $CHOG" footer="THE DISTINCTION THE PRODUCT INSISTS ON">
          <p className="muted">
            The real $CHOG lives on Monad mainnet at <code>{shortAddress(MAINNET.chogToken as Address)}</code>.
            Nothing on this page can move it, and nothing here pretends to.
          </p>
          <p className="muted">
            Test CHOG is a separate testnet token at <code>{shortAddress(token())}</code>, minted only by
            its own faucet, capped per wallet per day so a single address cannot farm an unbounded
            supply. That cap is what keeps side prizes and draft rerolls meaningful.
          </p>
          <p className="muted small">
            Decimals: {TEST_CHOG_DECIMALS}. Token address and label are read from the contract, not
            hardcoded in this page.
          </p>
        </Card>
      </Panel>

      {note && <Toast tone="info" message={note} />}
      {wallet.txError && <Toast tone="danger" message={wallet.txError} />}
    </>
  );
}
