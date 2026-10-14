import { useState } from "react";
import { Badge, Button, Card, Stat, Toast } from "@chogpool/ui";
import { getGameSource } from "../lib/game";
import { navigate } from "../lib/router";

export default function Deposit() {
  const source = getGameSource();
  const fixturesOn = source?.kind === "fixture";
  const [amount, setAmount] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [toast, setToast] = useState<{ tone: "info" | "success" | "danger"; message: string } | null>(null);
  const [bound, setBound] = useState<string | null>(null);

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
        <Toast tone="info" message="DEV FIXTURE MODE (VITE_FIXTURES=1): this flow is simulated. No real funds move." />
      )}

      <div className="deposit-grid">
        <Card
          title="Deposit flow"
          aside={<Badge tone={fixturesOn ? "accent" : "neutral"}>{fixturesOn ? "FIXTURE · SIMULATED" : "AWAITING PHASE 1 CONTRACTS"}</Badge>}
          footer="INTERFACES FROZEN: deposit(usdc) · withdraw(shares) · withdrawAll() · depositOf(tokenId)"
        >
          {source ? (
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
          ) : (
            <p className="muted">
              The deposit flow goes live with the pool contract (Phase 1). The interface is frozen
              (IChogPool), so this page wires straight in when the teammate's contracts deploy.
              Run the dev build with <code>VITE_FIXTURES=1</code> to walk the flow visually today.
            </p>
          )}
          {toast && <div className="toast-row"><Toast tone={toast.tone} message={toast.message} /></div>}
        </Card>

        <Card title="Your position" footer="READ-ONLY PREVIEW · VALUES COME FROM THE GAME SOURCE">
          {source ? (
            <>
              <Stat label="BOUND CHOG" value={bound ? `#${bound}` : "—"} note="One wallet may bind several Chogs; each has its own book." />
              <Stat label="DEPOSIT" value={bound ? "Recorded (fixture)" : "—"} note="TWAB odds favor time in the pool, not last-second size." tone="lime" />
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
