// /deposit, the deposit dashboard, on the real money path.
//
// The funding sequence is not three buttons that can be pressed in any order.
// The pool's asset is not mintable: the only way in is
//   StableFaucet.claim() -> swap on the real router -> approve -> deposit.
// The page walks that in order, and each step is enabled only when the previous
// one is genuinely needed, so nobody approves before they have the asset or
// deposits before they have approved.
//
// Withdraw is always available and always full: principal comes back in full,
// which is the property the product claims.

import { useEffect, useMemo, useState } from "react";
import { type Address } from "viem";
import { Badge, Button, Card, Panel, Stat, Toast } from "@chogpool/ui";
import { useWallet, type MoneyBalances } from "../lib/useWallet";
import {
  ASSET,
  approveAsset,
  claimStableFaucet,
  cooldownLabel,
  depositToPool,
  formatUsdc,
  parseUsdc,
  quoteQuoteToAsset,
  swapQuoteToAsset,
  withdrawAllFromPool,
} from "../lib/money";
import { navigate } from "../lib/router";
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
  { type: "function", name: "depositOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "twabOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "oddsBpsOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalPrincipal", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "potBalance", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "nextDrawAt", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
] as const;

const pool = () => DEPLOYED.pool as Address;

type Position = {
  shares: bigint;
  principal: bigint;
  twab: bigint;
  oddsBps: bigint;
};

export default function Deposit() {
  const wallet = useWallet();
  const [tokenIdText, setTokenIdText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [position, setPosition] = useState<Position | null>(null);
  const [poolStats, setPoolStats] = useState<{ totalShares: bigint; totalPrincipal: bigint; pot: bigint; nextDrawAt: number } | null>(null);
  const [quote, setQuote] = useState<bigint | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Whether the connected wallet holds the mirror for the entered Chog. The
  // pool rejects deposits against a Chog the depositor does not hold, so this
  // is read up front rather than discovered by a reverted transaction.
  const [holdsMirror, setHoldsMirror] = useState<boolean | null>(null);

  const tokenId = useMemo(() => {
    const raw = tokenIdText.trim();
    if (!/^\d{1,4}$/.test(raw)) return null;
    const id = BigInt(raw);
    return id >= 1n && id <= MAX_SUPPLY ? id : null;
  }, [tokenIdText]);

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
        const [shares, principal, twab, oddsBps] = await Promise.all([
          testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "sharesOf", args: [tokenId] }),
          testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "depositOf", args: [tokenId] }),
          testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "twabOf", args: [tokenId] }),
          testnetReadClient.readContract({ address: pool(), abi: poolReadAbi, functionName: "oddsBpsOf", args: [tokenId] }),
        ]);
        setPosition({ shares, principal, twab, oddsBps });
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
  const canDeposit = amount !== null && amount > 0n && usdc >= amount && !needsApproval;

  async function claimFaucet() {
    setNote(null);
    const ok = await wallet.runTx(claimStableFaucet, () => {
      setNote("Claimed. Swap it into the pool's USDC, then deposit.");
    });
    if (ok) void wallet.refresh();
  }

  async function swapQuote() {
    setNote(null);
    const ok = await wallet.runTx(
      (walletClient, account) => swapQuoteToAsset(walletClient, account, quoteBalance, quote ?? 0n, testnetReadClient),
      () => setNote("Swapped. Your wallet now holds the pool's USDC."),
    );
    if (ok) void wallet.refresh();
  }

  async function approve() {
    if (amount === null) return;
    setNote(null);
    const ok = await wallet.runTx(
      (walletClient, account) => approveAsset(walletClient, account, amount),
      () => setNote("Approved. You can deposit now."),
    );
    if (ok) void wallet.refresh();
  }

  async function deposit() {
    if (amount === null || tokenId === null) return;
    setNote(null);
    const ok = await wallet.runTx(
      (walletClient, account) => depositToPool(walletClient, account, tokenId, amount),
      () => setNote(`Deposited against Chog #${tokenId}. Time in the pool is what earns odds.`),
    );
    if (ok) void wallet.refresh();
  }

  async function withdrawAll() {
    if (tokenId === null) return;
    setNote(null);
    const ok = await wallet.runTx(
      (walletClient, account) => withdrawAllFromPool(walletClient, account, tokenId),
      () => setNote("Withdrawn. Principal returns in full; only the yield stays in the pot."),
    );
    if (ok) void wallet.refresh();
  }

  const busy = wallet.txStage === "pending";

  return (
    <>
      <section className="page-head">
        <p className="kicker">DEPOSIT</p>
        <h1>Save to race.</h1>
        <p className="lede">
          Deposit testnet USDC against a Chog and its time-weighted balance enters every draw.
          Principal comes back in full, any time. Only realized yield feeds the prize pot.
        </p>
        <div className="network-note"><span className="status-dot" /> Play: Monad Testnet · test funds only</div>
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
                  note={quoteBalance > 0n && quote !== null ? `worth about ${formatUsdc(quote)} USDC` : "claim to receive some"}
                />
              </div>

              <div className="button-row">
                <Button onClick={() => void claimFaucet()} disabled={busy || stableReady > now}>
                  {stableReady > now
                    ? `Faucet ready in ${cooldownLabel(stableReady, now)}`
                    : busy ? "Sending…" : "Claim 1,000 USDT"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void swapQuote()}
                  disabled={busy || quoteBalance === 0n}
                >
                  {busy ? "Sending…" : `Swap ${formatUsdc(quoteBalance)} USDT → USDC`}
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
              aside={<Badge tone={needsApproval ? "accent" : "neutral"}>{needsApproval ? "STEP 3 · APPROVE" : "STEP 4 · DEPOSIT"}</Badge>}
              footer="ONE BOOK PER CHOG: DEPOSIT AS MANY CHOGS AS YOU HOLD"
            >
              <label className="field">
                <span>CHOG ID (1–1,969)</span>
                <input inputMode="numeric" placeholder="1462" value={tokenIdText} onChange={(e) => setTokenIdText(e.target.value)} />
              </label>
              <label className="field">
                <span>AMOUNT (USDC)</span>
                <input inputMode="decimal" placeholder="10.00" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
              </label>

              {position && (
                <div className="stat-row">
                  <Stat label="YOUR SHARES" value={wallet.reading ? "…" : formatUsdc(position.shares)} tone="lime" />
                  <Stat label="YOUR PRINCIPAL" value={formatUsdc(position.principal)} note="What you can withdraw, in full." />
                  <Stat
                    label="YOUR ODDS"
                    value={position.oddsBps === 0n ? ": " : `${(Number(position.oddsBps) / 100).toFixed(2)}%`}
                    note="Time-weighted share of the draw. Grows with time held, not last-minute size."
                  />
                </div>
              )}

              <div className="button-row">
                {needsApproval ? (
                  <Button onClick={() => void approve()} disabled={busy}>
                    {busy ? "Sending…" : `Approve ${formatUsdc(amount ?? 0n)} USDC`}
                  </Button>
                ) : (
                  <Button
                    onClick={() => void deposit()}
                    disabled={busy || !canDeposit || tokenId === null || holdsMirror === false}
                  >
                    {busy ? "Sending…" : "Deposit"}
                  </Button>
                )}
                {position && position.shares > 0n && (
                  <Button variant="outline" onClick={() => void withdrawAll()} disabled={busy}>
                    {busy ? "Sending…" : "Withdraw all"}
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
            <Stat label="PRIZE POT" value={poolStats ? `${formatUsdc(poolStats.pot)} USDC` : "…"} note="Grows only from realized yield. Nobody can inflate it." tone="accent" />
            <Stat label="TOTAL DEPOSITED" value={poolStats ? `${formatUsdc(poolStats.totalPrincipal)} USDC` : "…"} note="Current holdings across all Chogs, not lifetime." />
            <Stat
              label="NEXT DRAW"
              value={poolStats && poolStats.nextDrawAt > 0 ? new Date(poolStats.nextDrawAt * 1000).toUTCString() : "None scheduled"}
              note="Draws are opened by the operator, on demand."
            />
          </div>
          <Button variant="outline" onClick={() => navigate("/verify")}>How draws stay fair ↗</Button>
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
