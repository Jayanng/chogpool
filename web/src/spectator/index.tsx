import { useCallback, useEffect, useState } from "react";
import { parseUnits, type Address, type WalletClient } from "viem";
import { Badge, Button, Card, Panel, Toast } from "@chogpool/ui";
import { navigate } from "../lib/router";
import {
  connectWallet,
  detectWallet,
  shortAddress,
  switchToTestnet,
  testnetReadClient,
} from "../lib/wallet";
import {
  claimTestChog,
  readClaimState,
  readTestChogBalance,
  sendCheer,
  TEST_CHOG_DECIMALS,
  type ClaimState,
} from "../lib/cheer";
import { testChogAbi } from "../lib/abi";
import { DEPLOYED } from "../generated/addresses.gen";
import { formatTestChog, shortHex } from "../lib/format";
import { readCurrentRaceId } from "../lib/game";
import { RaceShow } from "../race/RaceShow";
import { useRaceBundle, type RacerDisplay } from "../race/useRaceBundle";

/**
 * Spectator mode: the whole race with no wallet and no deposit. Cheering is
 * optional and real: a cheer is a Test $CHOG ERC-20 transfer from the fan's
 * wallet to the racer's team wallet on Monad testnet. No pot holds anything in
 * between; the chain records every cheer as it happens.
 */
export default function Spectator() {
  const [drawId, setDrawId] = useState<bigint | null>(null);
  const { bundle, loading, error, reload } = useRaceBundle(drawId);

  useEffect(() => {
    let cancelled = false;
    readCurrentRaceId()
      .then((id) => {
        if (!cancelled && id !== null) setDrawId(id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <section className="page-head">
        <p className="kicker">SPECTATOR MODE</p>
        <h1>Watch without a wallet.</h1>
        <p className="lede">
          Every race is viewable with no wallet and no deposit. Cheer with Test $CHOG tips that land in the
          racer's team wallet as soon as the transaction is mined. Not a holder? The card below explains the two
          clearly-labeled ways onto the track.
        </p>
        <Badge tone="neutral">NO WALLET NEEDED TO WATCH</Badge>
      </section>

      {loading && <Panel className="feature-panel"><p className="muted">Reading the race from the chain…</p></Panel>}
      {error && (
        <Panel className="feature-panel">
          <p className="viewer-error" role="alert">{error}</p>
          <div className="hero-actions">
            <Button variant="outline" onClick={reload}>Try again</Button>
            <Button variant="quiet" onClick={() => navigate("/race")}>Open the race show</Button>
          </div>
        </Panel>
      )}
      {drawId === null && !loading && (
        <Panel className="feature-panel">
          <Card title="Nothing to watch yet" footer="THE BOARD LIVES ON CHAIN">
            <p className="muted">
              No draw has been opened on chain yet, so the board is quiet. The moment one opens, this page
              shows the field, the countdown and the replay, with no wallet required.
            </p>
            <div className="hero-actions">
              <Button variant="outline" onClick={reload}>Check the chain again</Button>
            </div>
          </Card>
        </Panel>
      )}

      {bundle && <RaceShow bundle={bundle} />}
      {bundle && <CheerBoard racers={bundle.racers} drawId={bundle.draw.drawId.toString()} />}

      <Panel className="feature-panel">
        <Card
          title="Not a Chog holder yet?"
          aside={<Badge tone="accent">GET A CHOG</Badge>}
          footer="THE PRODUCTION PATH ACCEPTS REAL CHOGS ONLY"
        >
          <p className="muted">
            Chog Genesis is a 1,969-piece collection on Monad. Your Chog is the key to the track: it binds the
            deposit, it races the yield, and it keeps the career. On this testnet build each racer's mirror
            badge is shown wherever the mirror records one: <strong>Verified Holder</strong> when the real
            mainnet owner signed the mint, or <strong>Test Drive</strong> when it is a one-per-wallet demo
            token. The two are never blurred, on this site or on chain.
          </p>
          <div className="hero-actions">
            <a
              className="ui-button ui-button--primary"
              href="https://opensea.io/collection/chog-genesis"
              target="_blank"
              rel="noreferrer"
            >
              Get a Chog ↗
            </a>
            <Button variant="quiet" onClick={() => navigate("/draft")}>Draft Night first</Button>
          </div>
        </Card>
      </Panel>
    </>
  );
}

type Cheer = { tokenId: bigint; amount: bigint; txHash: string };

function CheerBoard({ racers, drawId }: { racers: RacerDisplay[]; drawId: string }) {
  const detected = detectWallet();
  const [wallet, setWallet] = useState<{ address: Address; walletClient: WalletClient } | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [claim, setClaim] = useState<ClaimState | null>(null);
  const [teamBacking, setTeamBacking] = useState<Record<string, string>>({});
  const [amountText, setAmountText] = useState("10");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "info" | "success" | "danger"; message: string } | null>(null);
  const [cheers, setCheers] = useState<Cheer[]>([]);

  const refreshBacking = useCallback(async () => {
    const entries = await Promise.all(
      racers.map(async (racer) => {
        if (!racer.team) return [racer.tokenId.toString(), "unknown"] as const;
        try {
          const raw = await readTestChogBalance(racer.team);
          return [racer.tokenId.toString(), formatTestChog(raw)] as const;
        } catch {
          return [racer.tokenId.toString(), "unavailable"] as const;
        }
      }),
    );
    setTeamBacking(Object.fromEntries(entries));
  }, [racers]);

  useEffect(() => {
    void refreshBacking();
  }, [refreshBacking]);

  const refreshWallet = useCallback(async (address: Address) => {
    try {
      setBalance(await readTestChogBalance(address));
      setClaim(await readClaimState(address));
    } catch {
      setBalance(null);
      setClaim(null);
    }
  }, []);

  async function connect() {
    try {
      const state = await connectWallet();
      if (state.chainId !== 10143) await switchToTestnet(state.walletClient);
      setWallet({ address: state.address, walletClient: state.walletClient });
      await refreshWallet(state.address);
      setStatus({ tone: "info", message: `Connected ${shortAddress(state.address)} on Monad testnet.` });
    } catch (e) {
      setStatus({ tone: "danger", message: e instanceof Error ? e.message : "Connection failed." });
    }
  }

  async function claimFaucet() {
    if (!wallet) return;
    setBusy(true);
    setStatus(null);
    try {
      const hash = await claimTestChog(wallet.walletClient, wallet.address);
      setStatus({ tone: "success", message: `Faucet claim sent (tx ${shortHex(hash, 10, 8)}).` });
      await refreshWallet(wallet.address);
    } catch (e) {
      setStatus({ tone: "danger", message: e instanceof Error ? e.message : "The claim did not go through." });
    } finally {
      setBusy(false);
    }
  }

  async function cheer(racer: RacerDisplay) {
    if (!wallet) return;
    if (!racer.team) {
      setStatus({ tone: "danger", message: "This racer has no team wallet recorded on chain." });
      return;
    }
    let amount: bigint;
    try {
      amount = parseUnits(amountText.trim() || "0", TEST_CHOG_DECIMALS);
    } catch {
      setStatus({ tone: "danger", message: "Enter a Test $CHOG amount like 10." });
      return;
    }
    if (amount <= 0n) {
      setStatus({ tone: "danger", message: "A cheer needs to be above zero Test $CHOG." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const hash = await sendCheer(wallet.walletClient, wallet.address, racer.team, amount);
      setCheers((prev) => [{ tokenId: racer.tokenId, amount, txHash: hash }, ...prev]);
      setStatus({
        tone: "success",
        message: `Cheer sent for CHOG #${racer.tokenId.toString()}: ${formatTestChog(amount)} (tx ${shortHex(hash, 10, 8)}).`,
      });
      await Promise.all([refreshWallet(wallet.address), refreshBacking()]);
    } catch (e) {
      setStatus({ tone: "danger", message: e instanceof Error ? e.message : "The cheer did not go through." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="feature-panel">
      <Card
        title="Cheer with Test $CHOG"
        aside={<Badge tone="accent">TEST $CHOG · PLAY MONEY ON TESTNET</Badge>}
        footer="EACH CHEER IS A REAL ERC-20 TRANSFER TO THE RACER'S TEAM WALLET"
      >
        <p className="muted">
          Cheering is how the crowd backs a racer. Your Test $CHOG leaves your wallet and lands in the
          team wallet behind that racer the moment the transaction is mined. Nothing is held in between
          and nothing here is a mock: each racer's backing figure below is the live Test $CHOG balance
          of its team wallet, and every cheer is a real transfer you can find on chain.
        </p>

        <div className="cheer-amount">
          <label className="field">
            <span>CHEER SIZE (TEST $CHOG)</span>
            <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" />
          </label>
          <div className="hero-actions">
            {["10", "50", "100"].map((preset) => (
              <Button key={preset} variant="outline" onClick={() => setAmountText(preset)}>{preset}</Button>
            ))}
          </div>
        </div>

        {!wallet && (
          <div className="hero-actions">
            <Button onClick={() => void connect()} disabled={!detected.present}>
              {detected.present ? "Connect wallet to cheer" : "No browser wallet detected"}
            </Button>
          </div>
        )}

        {wallet && (
          <div className="cheer-wallet">
            <p className="viewer-line"><span>WALLET</span><code>{shortHex(wallet.address, 10, 8)}</code></p>
            <p className="viewer-line"><span>TEST $CHOG</span><strong>{balance === null ? "reading…" : formatTestChog(balance)}</strong></p>
            {claim && (
              <div className="hero-actions">
                <Button
                  variant="outline"
                  onClick={() => void claimFaucet()}
                  disabled={busy || claim.nextClaimAt > Math.floor(Date.now() / 1000)}
                >
                  {claim.nextClaimAt > Math.floor(Date.now() / 1000)
                    ? `Faucet ready again ${new Date(claim.nextClaimAt * 1000).toLocaleTimeString()}`
                    : `Claim ${formatTestChog(claim.claimAmount)} from the faucet`}
                </Button>
              </div>
            )}
          </div>
        )}

        {status && <Toast tone={status.tone} message={status.message} />}

        <div className="cheer-grid">
          {racers.map((racer) => (
            <div className="cheer-lane" key={racer.tokenId.toString()}>
              <div className="show-lane-head">
                <span className="show-lane-id">CHOG #{racer.tokenId.toString()}</span>
                <span className="show-lane-name">{racer.name}</span>
                {racer.badge && racer.badge.badge !== 0 && (
                  <Badge tone={racer.badge.badge === 2 ? "lime" : "neutral"}>{racer.badge.badgeLabel}</Badge>
                )}
              </div>
              <p className="viewer-line">
                <span>TEAM</span><code>{racer.team ? shortHex(racer.team, 10, 8) : "no team wallet on chain"}</code>
              </p>
              <p className="viewer-line">
                <span>BACKING</span>
                <strong>{teamBacking[racer.tokenId.toString()] ?? "reading…"}</strong>
              </p>
              <Button
                onClick={() => void cheer(racer)}
                disabled={busy || wallet === null}
                title={wallet ? undefined : "Connect a wallet to cheer"}
              >
                Cheer {amountText || "0"} Test $CHOG
              </Button>
            </div>
          ))}
        </div>

        {cheers.length > 0 && (
          <div className="cheer-log">
            <p className="kicker">YOUR CHEERS THIS VISIT</p>
            {cheers.map((cheer) => (
              <p className="viewer-line" key={cheer.txHash}>
                <span>SENT</span>
                <code>{formatTestChog(cheer.amount)} → CHOG #{cheer.tokenId.toString()} · {shortHex(cheer.txHash, 10, 8)}</code>
              </p>
            ))}
          </div>
        )}

        <p className="viewer-note">
          Backing reads the team wallet's live Test $CHOG balance, so it counts this race's cheers plus anything
          else that wallet holds. Every cheer itself is visible in the wallet's transfer history on chain.
        </p>
      </Card>
    </Panel>
  );
}
