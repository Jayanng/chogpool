// /deposit, the deposit dashboard, on the real money path.
//
// The funding sequence is not three buttons that can be pressed in any order.
// The pool's asset is not mintable: the only way in is
//   StableFaucet.claim() -> swap on the real router -> approve -> deposit.
// The page walks that in order, and each step is enabled only when the previous
// one is genuinely needed, so nobody approves before they have the asset or
// deposits before they have approved.
//
// Withdraw is always available and charges no fee. You receive your shares of
// the pool at live value, which is the property the product claims.

import { useEffect, useMemo, useState } from "react";
import { type Address } from "viem";
import { Badge, Button, Card, Panel, Stat, Toast } from "@chogpool/ui";
import { useWallet, type MoneyBalances } from "../lib/useWallet";
import { busyStates } from "../lib/tx-pending";
import {
  ASSET,
  approveAsset,
  approveQuoteForRouter,
  claimStableFaucet,
  cooldownLabel,
  depositToPool,
  formatUsdc,
  parseUsdc,
  quoteQuoteToAsset,
  readQuoteRouterAllowance,
  swapQuoteToAsset,
  withdrawAllFromPool,
} from "../lib/money";
import { navigate } from "../lib/router";
import { loadMyChog } from "../lib/mychog";
import { shortAddress } from "../lib/wallet";
import { testnetReadClient } from "../lib/wallet";
import { CHAIN, DEPLOYED } from "../generated/addresses.gen";

const MAX_SUPPLY = 1969n;

// Live pool reads, kept here rather than in live.ts so this page can refresh
// them the instant a transaction confirms, without a full page reload.
// The pool requires the depositor to hold the mirrored Chog, so the deposit
// page reads the mirror's owner before offering the action.
const mirrorReadAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "isUnclaimed", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const poolReadAbi = [
  { type: "function", name: "sharesOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  // depositOf returns the depositor and both counters. Reading it as a bare
  // uint256 decoded the depositor ADDRESS as the principal and printed a
  // giant number where the position's principal belongs.
  { type: "function", name: "depositOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [
      { name: "depositor", type: "address" },
      { name: "shares", type: "uint256" },
      { name: "principal", type: "uint256" },
    ] },
  { type: "function", name: "twabOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "oddsBpsOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalPrincipal", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "potBalance", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "nextDrawAt", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
] as const;

/// The LP venue. `positionValue()` is what the venue can actually deliver right
/// now, which is the only honest basis for a withdrawable figure.
const adapterReadAbi = [
  { type: "function", name: "positionValue", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

const pool = () => DEPLOYED.pool as Address;
const adapter = () => DEPLOYED.yieldAdapter as Address;

/// What a position can actually withdraw right now: its pro-rata slice of the
/// venue's live value, never more than its own share claim.
///
/// WHY THIS IS NOT `depositOf`'s principal. The pool credits shares against the
/// value it put in at deposit time, and the venue's value then moves with trading,
/// so "what was credited" and "what the chain can hand back" are different numbers.
/// Showing the credited figure next to a withdraw button is what produced a button
/// labelled "Withdraw all" that reverted on screen, right next to copy reading
/// "What you can withdraw, in full." The number a user acts on must be the number
/// the chain will honour.
async function readWithdrawable(tokenId: bigint): Promise<bigint> {
  const [shares, totalShares, venueValue] = await Promise.all([
    testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "sharesOf", args: [tokenId] }),
    testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "totalShares" }),
    testnetReadClient.readContract({ address: adapter(), abi: adapterReadAbi, functionName: "positionValue" }),
  ]);
  if (shares === 0n || totalShares === 0n) return 0n;
  const slice = (venueValue * shares) / totalShares;
  return slice > shares ? shares : slice;
}

// Every money button on this page, for per-button pending tracking. One
// transaction in flight marks only its own button as sending.
const MONEY_ACTIONS = ["claim", "swap", "approve", "deposit", "withdraw"] as const;
type MoneyAction = (typeof MONEY_ACTIONS)[number];

type Position = {
  shares: bigint;
  principal: bigint;
  twab: bigint;
  /** What the chain will actually pay out right now. May be below `principal`. */
  withdrawable: bigint;
};

export default function Deposit() {
  const wallet = useWallet();
  const [tokenIdText, setTokenIdText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [position, setPosition] = useState<Position | null>(null);
  const [poolStats, setPoolStats] = useState<{ totalShares: bigint; totalPrincipal: bigint; pot: bigint; nextDrawAt: number } | null>(null);
  const [quote, setQuote] = useState<bigint | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Which action is in flight, so only its own button says "Sending...".
  const [pending, setPending] = useState<MoneyAction | null>(null);
  // Whether the connected wallet holds the mirror for the entered Chog. The
  // pool rejects deposits against a Chog the depositor does not hold, so this
  // is read up front rather than discovered by a reverted transaction.
  const [holdsMirror, setHoldsMirror] = useState<boolean | null>(null);

  // The Chog this wallet brought to the track, recorded when it was minted. The
  // form is prefilled with it so nobody types an id they might get wrong.
  const myChog = useMemo(() => (wallet.address ? loadMyChog(wallet.address) : null), [wallet.address]);
  useEffect(() => {
    if (myChog !== null && tokenIdText === "") setTokenIdText(myChog.toString());
  }, [myChog, tokenIdText]);

  const tokenId = useMemo(() => {
    if (myChog !== null) return myChog;
    const raw = tokenIdText.trim();
    if (!/^\d{1,4}$/.test(raw)) return null;
    const id = BigInt(raw);
    return id >= 1n && id <= MAX_SUPPLY ? id : null;
  }, [myChog, tokenIdText]);

  const amount = useMemo(() => parseUsdc(amountText), [amountText]);

  // Pool-level stats are global; they refresh after every confirmed write.
  useEffect(() => {
    if (!DEPLOYED) return;
    void (async () => {
      try {
        const [totalShares, totalPrincipal, pot, nextDrawAt] = await Promise.all([
          testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "totalShares" }),
          testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "totalPrincipal" }),
          testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "potBalance" }),
          testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "nextDrawAt" }),
        ]);
        setPoolStats({ totalShares, totalPrincipal, pot, nextDrawAt: Number(nextDrawAt) });
      } catch {
        setPoolStats(null);
      }
    })();
  }, [wallet.txStage]);

  // Per-token position, refreshed after each write and when the id changes.
  useEffect(() => {
    if (tokenId === null) {
      setPosition(null);
      return;
    }
    void (async () => {
      try {
        const [shares, deposit, twab, withdrawable] = await Promise.all([
          testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "sharesOf", args: [tokenId] }),
          testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "depositOf", args: [tokenId] }),
          testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "twabOf", args: [tokenId] }),
          // The honest withdrawable figure: this position's pro-rata slice of the
          // venue's live value. The pool's `principal` is what was credited, and
          // those are different numbers once the venue has traded, which is exactly
          // the state that used to make "Withdraw all" revert on screen.
          readWithdrawable(tokenId),
        ]);
        setPosition({ shares, principal: deposit[2], twab, withdrawable });
      } catch {
        setPosition(null);
      }
    })();

    if (!wallet.address) {
      setHoldsMirror(null);
      return;
    }
    void (async () => {
      try {
        const owner = await testnetReadClient.readContract({
          address: DEPLOYED.mirror as Address,
          abi: mirrorReadAbi,
          functionName: "ownerOf",
          args: [tokenId],
        });
        setHoldsMirror(owner.toLowerCase() === wallet.address!.toLowerCase());
      } catch {
        setHoldsMirror(false);
      }
    })();
  }, [tokenId, wallet.txStage, wallet.address]);

  // A live quote for whatever quote balance is held, so the user sees what a
  // swap is worth before they sign anything.
  useEffect(() => {
    const quoteBalance = wallet.balances.quote ?? 0n;
    if (quoteBalance === 0n) {
      setQuote(null);
      return;
    }
    void quoteQuoteToAsset(testnetReadClient, quoteBalance).then(setQuote);
  }, [wallet.balances.quote]);

  const balances: MoneyBalances = wallet.balances;
  const usdc = balances.usdc ?? 0n;
  const quoteBalance = balances.quote ?? 0n;
  const allowance = balances.allowance ?? 0n;
  const now = Math.floor(Date.now() / 1000);
  const stableReady = balances.stableFaucetReadyAt ?? 0;

  const needsApproval = amount !== null && amount > 0n && allowance < amount;
  const canDeposit = amount !== null && amount > 0n && usdc >= amount && !needsApproval && holdsMirror === true;

  async function claimFaucet() {
    setNote(null);
    setPending("claim");
    try {
      const ok = await wallet.runTx(claimStableFaucet, () => {
        setNote("Claimed. Swap it into the pool's USDC, then deposit.");
      }, "Claimed 1,000 USDT from the faucet");
      if (ok) void wallet.refresh();
    } finally {
      setPending(null);
    }
  }

  async function swapQuote() {
    setNote(null);
    setPending("swap");
    try {
      // The router pulls the quote token with transferFrom, so it needs an
      // allowance first. A swap without one reverts on chain every time.
      if (wallet.address && quoteBalance > 0n) {
        const granted = await readQuoteRouterAllowance(testnetReadClient, wallet.address as Address);
        if (granted < quoteBalance) {
          const approved = await wallet.runTx(
            (walletClient, account) => approveQuoteForRouter(walletClient, account, quoteBalance),
            () => setNote("Approved the router to take the USDT. Sending the swap now."),
            "Approved USDT for the swap",
          );
          if (!approved) return;
        }
      }
      const ok = await wallet.runTx(
        (walletClient, account) => swapQuoteToAsset(walletClient, account, quoteBalance, quote ?? 0n, testnetReadClient),
        () => setNote("Swapped. Your wallet now holds the pool's USDC."),
        `Swapped ${formatUsdc(quoteBalance)} USDT into USDC`,
      );
      if (ok) void wallet.refresh();
    } finally {
      setPending(null);
    }
  }

  async function approve() {
    if (amount === null) return;
    setNote(null);
    setPending("approve");
    try {
      const ok = await wallet.runTx(
        (walletClient, account) => approveAsset(walletClient, account, amount),
        () => setNote("Approved. You can deposit now."),
        "Approved USDC for the pool",
      );
      if (ok) void wallet.refresh();
    } finally {
      setPending(null);
    }
  }

  async function deposit() {
    if (amount === null || tokenId === null) return;
    setNote(null);
    setPending("deposit");
    try {
      const ok = await wallet.runTx(
        (walletClient, account) => depositToPool(walletClient, account, tokenId, amount),
        () => setNote(`Deposited against Chog #${tokenId}. It is entered.`),
        `Deposited ${formatUsdc(amount)} USDC against Chog #${tokenId}`,
      );
      if (ok) void wallet.refresh();
    } finally {
      setPending(null);
    }
  }

  async function withdrawAll() {
    if (tokenId === null) return;
    setNote(null);
    setPending("withdraw");
    try {
      const ok = await wallet.runTx(
        (walletClient, account) => withdrawAllFromPool(walletClient, account, tokenId),
        () => setNote("Withdrawn. Principal returns in full; only the yield stays in the pot."),
        `Withdrew your principal from Chog #${tokenId}`,
      );
      if (ok) void wallet.refresh();
    } finally {
      setPending(null);
    }
  }

  // Each button is busy only while its own action is in flight. A claim
  // waiting on its receipt says nothing about the deposit button, so the
  // others keep their real labels and stay usable.
  const busy = busyStates(pending, MONEY_ACTIONS);

  return (
    <>
      <section className="page-head">
        <p className="kicker">DEPOSIT</p>
        <h1>Save to race.</h1>
        <p className="lede">
          Deposit testnet USDC against a Chog and its time-weighted balance enters every draw.
          Withdrawals are instant and charge no fee. You receive your shares of the pool at
          live value. Deposits are never used as prizes.
        </p>
        <div className="network-note"><span className="status-dot" /> Play: Monad Testnet · test funds only</div>
        {position && position.shares > 0n && (
          <div className="entered-banner" role="status">
            <strong>CHOG #{(myChog ?? tokenId)?.toString() ?? "?"} IS ENTERED</strong>
            <span>
              Your deposit is booked and this Chog is in every draw from now on. When a race runs,
              you will see it on the Race page.
            </span>
          </div>
        )}
      </section>

      {!wallet.connected ? (
        <Panel className="feature-panel">
          <Card title="Connect to deposit" footer="ALL FOUR STEPS NEED A WALLET ON MONAD TESTNET">
            <p className="muted">
              {wallet.walletPresent
                ? "Connect a wallet to claim, swap, approve and deposit."
                : "No browser wallet detected. Install MetaMask or Rabby, then reload."}
            </p>
            {wallet.connectError && <Toast tone="danger" message={wallet.connectError} />}
            <Button onClick={() => void wallet.connect()} disabled={wallet.connecting}>
              {wallet.connecting ? "Connecting…" : "Connect wallet"}
            </Button>
          </Card>
        </Panel>
      ) : wallet.onWrongChain ? (
        <Panel className="feature-panel">
          <Card title="Wrong network" aside={<Badge tone="danger">BLOCKED</Badge>} footer="DEPOSITS ONLY EXIST ON MONAD TESTNET">
            <p className="muted">Your wallet is on another network. Switch to Monad Testnet to deposit.</p>
            <Button onClick={() => void wallet.switchNetwork()}>Switch to Monad Testnet</Button>
          </Card>
        </Panel>
      ) : (
        <>
          <Panel className="feature-panel">
            <Card
              title="Fund your wallet"
              aside={<Badge tone="neutral">STEP 1–2</Badge>}
              footer="THE POOL'S USDC IS NOT MINTABLE: CLAIM, THEN SWAP THROUGH THE REAL ROUTER"
            >
              <div className="stat-row">
                <Stat label="WALLET USDC" value={wallet.reading ? "…" : `${formatUsdc(usdc)} USDC`} note={shortAddress(ASSET)} tone="accent" />
                <Stat
                  label="FAUCET QUOTE"
                  value={wallet.reading ? "…" : `${formatUsdc(quoteBalance)} USDT`}
                  note={quoteBalance > 0n && quote !== null ? `worth about ${formatUsdc(quote)} USDC` : "None yet, claim the faucet first"}
                />
              </div>

              <div className="button-row">
                <Button onClick={() => void claimFaucet()} disabled={busy.claim || stableReady > now}>
                  {stableReady > now
                    ? `Faucet in ${cooldownLabel(stableReady, now)}`
                    : busy.claim ? "Sending…" : "Claim 1,000 USDT"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void swapQuote()}
                  disabled={busy.swap || quoteBalance === 0n}
                >
                  {busy.swap ? "Sending…" : quoteBalance > 0n ? `Swap ${formatUsdc(quoteBalance)} USDT → USDC` : "Swap USDT → USDC"}
                </Button>
              </div>

              <p className="muted small">
                The faucet pays 1,000 USDT once per day. The pool's USDC is the real PuddleSwap
                token and cannot be minted, so the swap runs through the real router with a 1%
                slippage bound quoted immediately before sending.
              </p>
            </Card>
          </Panel>

          <Panel className="feature-panel">
            <Card
              title="Deposit"
              aside={<Badge tone={needsApproval ? "accent" : "neutral"}>{needsApproval ? "STEP 3 · APPROVE" : "STEP 3 · DEPOSIT"}</Badge>}
              footer="ONE BOOK PER CHOG: DEPOSIT AS MANY CHOGS AS YOU HOLD"
            >
              {myChog !== null ? (
                <div className="field">
                  <span>YOUR CHOG</span>
                  <div className="field-fixed">CHOG #{myChog.toString()}</div>
                </div>
              ) : (
                <label className="field">
                  <span>CHOG ID (1–1,969)</span>
                  <input inputMode="numeric" placeholder="1462" value={tokenIdText} onChange={(e) => setTokenIdText(e.target.value)} />
                </label>
              )}
              <label className="field">
                <span>AMOUNT (USDC)</span>
                <input inputMode="decimal" placeholder="10.00" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
                <span className="field-hint">
                  0 to {formatUsdc(usdc)} USDC available
                  <button type="button" className="field-max" onClick={() => setAmountText(formatUsdc(usdc))}>Max</button>
                </span>
                {amount !== null && amount > 0n && usdc < amount && quoteBalance > 0n && (
                  <span className="field-hint">
                    You hold USDT. The pool takes USDC. Use the swap in Fund your wallet first.
                  </span>
                )}
              </label>
              <p className="muted small">
                Getting back is the position's value at the time, not the number you type.
                LP entry and exit cost are real and can be visible in a small pool.
                {poolStats ? ` The pool's whole position is worth about ${formatUsdc(poolStats.totalShares)} USDC right now.` : ""}
              </p>

              {position && (
                <div className="stat-row">
                  <Stat label="YOUR SHARES" value={wallet.reading ? "…" : formatUsdc(position.shares)} tone="lime" />
                  <Stat
                    label="WITHDRAWABLE NOW"
                    value={wallet.reading ? "…" : formatUsdc(position.withdrawable)}
                    note={
                      position.withdrawable < position.principal
                        ? "Your live share of the LP position. Swap fees and price drift move this, so it can sit below your deposit."
                        : "Your live share of the LP position, paid out in full the moment you withdraw."
                    }
                  />
                </div>
              )}

              <div className="button-row">
                {needsApproval ? (
                  <Button onClick={() => void approve()} disabled={busy.approve}>
                    {busy.approve ? "Sending…" : `Approve ${formatUsdc(amount ?? 0n)} USDC`}
                  </Button>
                ) : (
                  <Button
                    onClick={() => void deposit()}
                    disabled={busy.deposit || !canDeposit || tokenId === null || holdsMirror !== true}
                  >
                    {busy.deposit ? "Sending…" : "Deposit"}
                  </Button>
                )}
                {position && position.shares > 0n && (
                  <Button variant="outline" onClick={() => void withdrawAll()} disabled={busy.withdraw}>
                    {busy.withdraw ? "Sending…" : "Withdraw all"}
                  </Button>
                )}
              </div>

              {amount !== null && amount > usdc && (
                <p className="muted small">You need {formatUsdc(amount - usdc)} more USDC. Claim and swap above.</p>
              )}
              {holdsMirror === false && (
                <>
                  <p className="muted small">
                    This wallet does not hold the mirror for Chog #{tokenId}, and the pool only accepts
                    deposits against a Chog you hold. Mirror it first, or deposit against a Chog you
                    already own.
                  </p>
                  <Button variant="outline" onClick={() => navigate("/mint")}>Mirror a Chog ↗</Button>
                </>
              )}
              {needsApproval && (
                <p className="muted small">
                  The pool is approved for {formatUsdc(allowance)} USDC. Approve this deposit's exact
                  amount, never an unlimited allowance.
                </p>
              )}
            </Card>
          </Panel>
        </>
      )}

      <Panel className="feature-panel">
        <Card title="The pool" footer="READ LIVE FROM THE POOL CONTRACT">
          <div className="stat-row">
            <Stat label="PRIZE POT" value={poolStats ? `${formatUsdc(poolStats.pot)} USDC` : "…"} note="Never fed by deposits. The demo pot is seeded by the team; the yield page separates seeded from earned." tone="accent" />
            <Stat label="TOTAL DEPOSITED" value={poolStats ? `${formatUsdc(poolStats.totalPrincipal)} USDC` : "…"} note="Current holdings across all Chogs, not lifetime." />
            <Stat
              label="NEXT DRAW"
              value={poolStats && poolStats.nextDrawAt > 0 ? new Date(poolStats.nextDrawAt * 1000).toUTCString() : "None scheduled"}
              note="When a round settles the top 3 split the pot. Deposits are open, and every stake is already entered."
            />
          </div>
          <Button variant="outline" onClick={() => navigate("/verify")}>How runs stay fair ↗</Button>
        </Card>
      </Panel>

      {note && <Toast tone="info" message={note} />}
      {wallet.txError && <Toast tone="danger" message={wallet.txError} />}
      {wallet.txHash && (
        <p className="muted small">
          {wallet.txStage === "pending" ? "Waiting for confirmation: " : "Transaction: "}
          <a href={`${CHAIN.monadTestnet.explorer}/tx/${wallet.txHash}`} target="_blank" rel="noreferrer">
            {wallet.txHash.slice(0, 14)}…
          </a>
        </p>
      )}
    </>
  );
}
