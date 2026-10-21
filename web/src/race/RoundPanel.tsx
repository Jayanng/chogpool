// The round: the live GameEngine state, on the Race section beside the book.
// Every line comes from the deployed engine's own views. When no round exists
// the card says so and stops; when one is open the card shows the contract's own
// clock and the revive fee the contract actually charges.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Stat } from "@chogpool/ui";
import { navigate } from "../lib/router";
import { formatTime } from "../lib/format";
import { loadMyChog } from "../lib/mychog";
import { useWallet } from "../lib/useWallet";
import {
  readReviveStatus,
  readRound,
  roundHeadline,
  sendPayRevive,
  type ReviveStatus,
  type RoundView,
} from "../lib/rounds";

function remaining(now: number, closesAt: number): string {
  const left = Math.max(0, closesAt - now);
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function RoundPanel() {
  const wallet = useWallet();
  const [round, setRound] = useState<RoundView | null>(null);
  const [unread, setUnread] = useState(false);
  const [revive, setRevive] = useState<ReviveStatus | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const refresh = useCallback(async () => {
    const read = await readRound();
    if (!read.ok) {
      setUnread(true);
      return;
    }
    setUnread(false);
    setRound(read.round);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A ticking clock only while a round can actually close.
  useEffect(() => {
    if (round?.state !== "open") return;
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [round?.state]);

  // While a round is open the field moves: re-read every 20s.
  useEffect(() => {
    if (round?.state !== "open") return;
    const id = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(id);
  }, [round?.state, refresh]);

  const tokenId = useMemo(
    () => (wallet.address ? loadMyChog(wallet.address) : null),
    [wallet.address],
  );

  useEffect(() => {
    if (!round || round.state !== "open" || !tokenId || !wallet.address) {
      setRevive(null);
      return;
    }
    let cancelled = false;
    void readReviveStatus(round.id, tokenId, wallet.address).then((status) => {
      if (!cancelled) setRevive(status);
    });
    return () => {
      cancelled = true;
    };
  }, [round, tokenId, wallet.address]);

  const headline = roundHeadline(round);
  const reviving = wallet.txStage === "pending";

  return (
    <Card
      title="The round"
      footer="READ LIVE FROM THE ROUND ENGINE · REVIVES AND COINS ARE CONTRACT RULES"
    >
      <h3 className="card-title">{headline.title}</h3>
      <p className="muted small">{headline.note}</p>

      {unread && (
        <p className="muted small">
          Could not read the round engine from the chain. Refresh the page to try again.
        </p>
      )}

      {round?.state === "open" && (
        <p className="muted small">
          Closing in <strong>{remaining(now, Number(round.closesAt))}</strong> (at{" "}
          {formatTime(Number(round.closesAt))}). {round.participants} run
          {round.participants === 1 ? "" : "s"} recorded so far.
        </p>
      )}

      {(round === null || round.state === "open") && (
        <div className="stat-row">
          <Stat label="REVIVE FEE" value="10 Test $CHOG" note="One revive per Chog per round. The fee is split with the round's top 3." tone="accent" />
          <Stat label="COINS" value="0.1 Test $CHOG each" note="Paid to your purse the moment your run is recorded on chain." tone="lime" />
          <Stat label="PRIZE SPLIT" value="50 / 30 / 20" note="Computed on chain at settlement from the close snapshot." />
        </div>
      )}

      {round?.state === "open" && (
        <div className="hero-actions">
          {!wallet.connected ? (
            <Button onClick={() => void wallet.connect()}>Connect a wallet to revive</Button>
          ) : tokenId === null ? (
            <Button variant="outline" onClick={() => navigate("/mint")}>
              Mint a Chog to revive
            </Button>
          ) : revive === null ? (
            <p className="muted small">Reading the revive state for Chog #{tokenId.toString()}…</p>
          ) : revive.used ? (
            <p className="muted small">
              Chog #{tokenId.toString()} already took its revive this round. The contract allows
              one per round.
            </p>
          ) : revive.balance < revive.fee ? (
            <p className="muted small">
              Chog #{tokenId.toString()} can revive for {(Number(revive.fee) / 1e18).toString()} Test
              $CHOG, but the wallet holds {(Number(revive.balance) / 1e18).toString()}. Claim Test
              $CHOG first.
            </p>
          ) : (
            <Button
              disabled={reviving}
              onClick={() =>
                void wallet
                  .runTx(
                    (walletClient, account) => sendPayRevive(walletClient, account, round.id, tokenId),
                    () => readReviveStatus(round.id, tokenId, wallet.address!).then(setRevive),
                    "Revive",
                  )
              }
            >
              {reviving ? "Reviving…" : "Pay the revive fee"}
            </Button>
          )}
        </div>
      )}

      {wallet.txStage === "failed" && wallet.txError && (
        <p className="viewer-error" role="alert">
          {wallet.txError}
        </p>
      )}
      {wallet.txStage === "confirmed" && wallet.txLabel === "Revive" && wallet.txHash && (
        <p className="muted small">
          Revive confirmed on chain.{" "}
          <a href={wallet.explorerTx(wallet.txHash)} target="_blank" rel="noreferrer">
            See the transaction
          </a>
          .
        </p>
      )}
    </Card>
  );
}
