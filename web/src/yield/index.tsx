// /yield, the yield rehearsal. Shows where deposited principal actually sits
// and what harvest has actually realized.
//
// This page exists because "your deposit earns yield" is a claim, and a claim
// needs numbers next to it. Every figure here is read from the adapter and the
// pool, and the harvest button triggers the real harvest that redeems a slice
// of the real LP position. Nothing is projected, annualised, or implied.
//
// The naming note, kept honest: Aave V3 is the production yield path on Monad
// mainnet and is NOT deployed on Monad testnet. What runs here is the real
// PuddleSwap LP adapter, which is the testnet implementation of the same frozen
// IYieldAdapter interface. The page says exactly that rather than implying a
// mainnet venue is live.

import { useEffect, useState } from "react";
import { type Address } from "viem";
import { Badge, Button, Card, Panel, Stat, Toast } from "@chogpool/ui";
import { useWallet } from "../lib/useWallet";
import { harvestPot, formatUsdc } from "../lib/money";
import { testnetReadClient } from "../lib/wallet";
import { DEPLOYED, MAINNET } from "../generated/addresses.gen";
import { navigate } from "../lib/router";
import { shortAddress } from "../lib/wallet";

const adapterAbi = [
  { type: "function", name: "principalDeployed", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "positionValue", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "liquidityUnits", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "pair", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

const poolAbi = [
  { type: "function", name: "potBalance", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "potSeeded", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalPrincipal", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

type YieldState = {
  principalDeployed: bigint;
  positionValue: bigint;
  liquidityUnits: bigint;
  asset: Address;
  pair: Address;
  pot: bigint;
  /** Total ever added by seedPot(). The earned yield is exactly `pot - seeded`. */
  seeded: bigint;
  totalPrincipal: bigint;
  totalShares: bigint;
};

const adapter = () => DEPLOYED.yieldAdapter as Address;
const pool = () => DEPLOYED.pool as Address;

export default function Yield() {
  const wallet = useWallet();
  const [state, setState] = useState<YieldState | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!DEPLOYED) return;
    void (async () => {
      try {
        const [principalDeployed, positionValue, liquidityUnits, asset, pair, pot, seeded, totalPrincipal, totalShares] = await Promise.all([
          testnetReadClient.readContract({ address: adapter(), abi: adapterAbi, functionName: "principalDeployed" }),
          testnetReadClient.readContract({ address: adapter(), abi: adapterAbi, functionName: "positionValue" }),
          testnetReadClient.readContract({ address: adapter(), abi: adapterAbi, functionName: "liquidityUnits" }),
          testnetReadClient.readContract({ address: adapter(), abi: adapterAbi, functionName: "asset" }),
          testnetReadClient.readContract({ address: adapter(), abi: adapterAbi, functionName: "pair" }),
          testnetReadClient.readContract({ address: pool(), abi: poolAbi, functionName: "potBalance" }),
          testnetReadClient.readContract({ address: pool(), abi: poolAbi, functionName: "potSeeded" }),
          testnetReadClient.readContract({ address: pool(), abi: poolAbi, functionName: "totalPrincipal" }),
          testnetReadClient.readContract({ address: pool(), abi: poolAbi, functionName: "totalShares" }),
        ]);
        setState({ principalDeployed, positionValue, liquidityUnits, asset, pair, pot, seeded, totalPrincipal, totalShares });
      } catch {
        setState(null);
      }
    })();
  }, [wallet.txStage]);

  // The unrealized surplus is the gap between what the LP position would redeem
  // for right now and the principal tracked as deployed. It only becomes prize
  // money when a harvest redeems a slice and swaps it, the UI never presents it
  // as if it were already in the pot.
  const surplus = state ? (state.positionValue > state.principalDeployed ? state.positionValue - state.principalDeployed : 0n) : 0n;

  async function harvest() {
    setNote(null);
    const ok = await wallet.runTx(harvestPot, () => {
      setNote("Harvested. The realized surplus is now in the prize pot.");
    }, "Harvested the yield into the prize pot");
    if (ok) void wallet.refresh();
  }

  return (
    <>
      <section className="page-head">
        <p className="kicker">YIELD</p>
        <h1>Where your<br /><em>principal sits.</em></h1>
        <p className="lede">
          Deposits go into a real liquidity position, not a ledger entry. This page reads the
          position's actual redemption value and the pot's actual balance. Nothing here is
          projected or annualised.
        </p>
        <div className="network-note"><span className="status-dot" /> Network: Monad Testnet · test funds only</div>
      </section>

      <Panel className="feature-panel">
        <Card
          title="The position"
          aside={<Badge tone="accent">REAL LP</Badge>}
          footer="REDEMPTION VALUE IS READ FROM THE PAIR, NOT COMPUTED FROM A RATE"
        >
          <div className="stat-row">
            <Stat label="PRINCIPAL DEPLOYED" value={state ? `${formatUsdc(state.principalDeployed)} USDC` : "…"} note="Current net principal in the LP, net of withdrawals. Entry cost and live drift show up as the gap to POSITION VALUE." />
            <Stat
              label="POSITION VALUE"
              value={state ? `${formatUsdc(state.positionValue)} USDC` : "…"}
              note="What the LP tokens redeem for right now, measured by the pair."
              tone="lime"
            />
            <Stat label="LP UNITS HELD" value={state ? Number(state.liquidityUnits).toLocaleString() : "…"} note="LP tokens backing the position." />
          </div>
          {state && (
            <p className="muted small">
              Pair {shortAddress(state.pair)} · asset {shortAddress(state.asset)}
            </p>
          )}
        </Card>
      </Panel>

      <Panel className="feature-panel">
        <Card
          title="Harvest"
          aside={<Badge tone={surplus > 0n ? "lime" : "neutral"}>{surplus > 0n ? "SURPLUS AVAILABLE" : "NO SURPLUS YET"}</Badge>}
          footer="HARVEST REDEEMS A SLICE, SWAPS IT, AND BOOKS ONLY WHAT ACTUALLY MOVED"
        >
          <div className="stat-row">
            <Stat
              label="UNREALIZED SURPLUS"
              value={state ? `${formatUsdc(surplus)} USDC` : "…"}
              note="Not prize money yet. It becomes prize money when a harvest realizes it."
            />
            <Stat
              label="PRIZE POT"
              value={state ? `${formatUsdc(state.pot)} USDC` : "…"}
              note={
                state && state.seeded > 0n
                  ? `Of this, ${formatUsdc(state.seeded)} USDC was seeded by hand for the demo and ${formatUsdc(state.pot - state.seeded)} USDC is yield the LP actually earned. Both are real, traceable transactions; they are not the same thing.`
                  : "Only realized, swapped value lands here."
              }
              tone="accent"
            />
            <Stat label="TOTAL DEPOSITED" value={state ? `${formatUsdc(state.totalPrincipal)} USDC` : "…"} note="Current holdings across all Chogs, net of withdrawals. The lifetime figure is separate and monotonic." />
          </div>

          <div className="button-row">
            <Button
              onClick={() => void harvest()}
              disabled={wallet.txStage === "pending" || !wallet.connected || wallet.onWrongChain || surplus === 0n}
            >
              {wallet.txStage === "pending" ? "Sending…" : "Harvest into the pot"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/deposit")}>Deposit more ↗</Button>
          </div>

          {!wallet.connected && <p className="muted small">Connect a wallet on Monad Testnet to harvest. Anyone can trigger it, the money only comes from real trades.</p>}
          {wallet.connected && surplus === 0n && (
            <p className="muted small">
              No surplus to harvest yet. Fees accrue inside the pair as trading volume happens;
              the surplus appears once the position's redemption value exceeds the deployed principal.
              The Monad testnet pair is quiet, so on this build the pot is{" "}
              {state && state.seeded > 0n ? (
                <>
                  seeded with faucet USDC (shown above, and tracked separately on-chain) rather than
                  funded by trading fees. The production venue is Aave on Monad mainnet.
                </>
              ) : (
                <>zero, and nothing about that is hidden.</>
              )}
            </p>
          )}
        </Card>
      </Panel>

      <Panel className="feature-panel">
        <Card title="Which venue is live" footer="SAID PLAINLY, BECAUSE IT MATTERS FOR JUDGES">
          <p className="muted">
            Aave V3 is the production yield path on Monad mainnet at{" "}
            <code>{shortAddress(MAINNET.aavePool as Address)}</code>. It is <strong>not</strong> deployed
            on Monad testnet, so nothing on this build touches it.
          </p>
          <p className="muted">
            What runs here is the PuddleSwap LP adapter: real liquidity in the real USDC/USDT pair,
            implementing the same frozen <code>IYieldAdapter</code> interface. The production venue
            swaps in behind that interface without changing the pool, the pot, or this page's
            numbers. The rehearsal is that the whole path, deposit, position, harvest, pot, 
            already works end to end against a real venue, just a different one.
          </p>
          <p className="muted small">
            Principal is never at risk beyond ordinary AMM impermanent loss, which is the honest
            trade-off of earning from real volume.
          </p>
        </Card>
      </Panel>

      {note && <Toast tone="info" message={note} />}
      {wallet.txError && <Toast tone="danger" message={wallet.txError} />}
    </>
  );
}
