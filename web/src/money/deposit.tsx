import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { Badge, Button, Card, Stat, Toast } from "@chogpool/ui";
import { getGameSource } from "../lib/game";
import { POT_DECIMALS } from "../types/game";
import { navigate } from "../lib/router";

export default function Deposit() {
  const source = getGameSource();
  const fixturesOn = source?.kind === "fixture";
  const liveOn = source?.kind === "live";
  const [amount, setAmount] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [toast, setToast] = useState<{ tone: "info" | "success" | "danger"; message: string } | null>(null);
  const [bound, setBound] = useState<string | null>(null);
  const [pot, setPot] = useState<bigint | null>(null);
  const [nextDrawAt, setNextDrawAt] = useState<number | null>(null);

  useEffect(() => {
    if (!source) return;
    void source.potBalance().then(setPot);
    void source.nextDrawAt().then(setNextDrawAt);
  }, [source]);

  async function deposit() {
    if (!source) return;
    const rawId = tokenId.trim();
    if (!/^\d{1,4}$/.test(rawId) || BigInt(rawId) < 1n || BigInt(rawId) > 1969n) {
      setToast({ tone: "danger", message: "Bind a real Chog ID from 1 to 1,969." });
      return;
    }
    const result = await source.deposit(amount, BigInt(rawId));
    if (result.status === "error") {
      setToast({ tone: "danger", message: result.detail });
      return;
    }
    setToast({ tone: "success", message: result.detail });
    setBound(rawId);
  }

  return (
    <>
      <section className="page-head">
        <p className="kicker">DEPOSIT</p>
        <h1>Save to race.</h1>
        <p className="lede">
          Deposit testnet USDC, bind it to a Chog, and your time-weighted balance enters every draw.
          Principal stays withdrawable in full, any time. Only yield feeds the prize pot.
        </p>
        <div className="network-note"><span className="status-dot" /> Play: Monad Testnet · test funds only</div>
      </section>

      {fixturesOn && (
        <Toast tone="info" message="DEV FIXTURE MODE: this flow is simulated. No real funds move." />
      )}

      <div className="deposit-grid">
        <Card
          title="Deposit flow"
          aside={
            <Badge tone={fixturesOn ? "accent" : "neutral"}>
              {fixturesOn ? "FIXTURE · SIMULATED" : liveOn ? "LIVE POOL · READ-ONLY" : "NOT LIVE YET"}
            </Badge>
          }
          footer="DEPOSIT, WITHDRAW AND PER-CHOG BOOKS, READ FROM THE POOL CONTRACT"
        >
          {fixturesOn ? (
            <>
              <label className="field">
                <span>AMOUNT (TEST USDC)</span>
                <input inputMode="decimal" placeholder="10.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="field">
                <span>BIND TO CHOG ID (1–1969)</span>
                <input inputMode="numeric" placeholder="1462" value={tokenId} onChange={(e) => setTokenId(e.target.value)} />
              </label>
              <Button onClick={() => void deposit()}>Deposit</Button>
            </>
          ) : liveOn ? (
            <p className="muted">
              The pool contract is live on Monad Testnet and this page reads it (pot, schedule,
              per-Chog books). Wallet deposits and withdrawals (faucet claim → approve → deposit → withdraw)
              are coming soon. Today, walk the full visual flow in the demo build.
            </p>
          ) : (
            <p className="muted">
              The pool contract is not connected in this build, so nothing here is simulated or
              guessed. The page is wired to the pool and fills in the moment it connects. Try the
              full visual flow in the demo build.
            </p>
          )}
          {toast && <div className="toast-row"><Toast tone={toast.tone} message={toast.message} /></div>}
        </Card>

        <Card title="Your position" footer="READ-ONLY PREVIEW · VALUES COME FROM THE GAME SOURCE">
          {fixturesOn ? (
            <>
              <Stat label="BOUND CHOG" value={bound ? `#${bound}` : "N/A"} note="One wallet may bind several Chogs; each has its own book." />
              <Stat label="DEPOSIT" value={bound ? "Recorded (fixture)" : "N/A"} note="TWAB odds favor time in the pool, not last-second size." tone="lime" />
            </>
          ) : liveOn ? (
            <>
              <Stat
                label="PRIZE POT"
                value={pot === null ? "…" : `${formatUnits(pot, POT_DECIMALS)} USDC`}
                note="Live from the pool contract (potBalance). Grows only from realized yield."
                tone="accent"
              />
              <Stat
                label="NEXT DRAW"
                value={nextDrawAt === null ? "Not scheduled yet" : new Date(nextDrawAt * 1000).toUTCString()}
                note="Live from the pool contract (nextDrawAt)."
              />
            </>
          ) : (
            <p className="muted">No game source connected yet. Nothing here is simulated in production builds.</p>
          )}
          <Button variant="outline" onClick={() => navigate("/verify")}>How draws stay fair ↗</Button>
        </Card>
      </div>
    </>
  );
}
