import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { Badge, Button, Card, Marquee, Panel, Stat, tokens } from "@chogpool/ui";
import { ChogViewer } from "../components/ChogViewer";
import { Countdown } from "../components/Countdown";
import { ShareCard } from "../components/ShareCard";
import { getGameSource } from "../lib/game";
import { CHAIN } from "../generated/addresses.gen";
import { POT_DECIMALS } from "../types/game";
import { ipfsToGateway, type ChogRecord } from "../lib/chog";
import { navigate } from "../lib/router";

export default function Landing() {
  const [nextDrawAt, setNextDrawAt] = useState<number | null>(null);
  const [pot, setPot] = useState<bigint | null>(null);
  const [sourceLabel, setSourceLabel] = useState("FROM THE GAME SOURCE (nextDrawAt)");
  const [lookedUp, setLookedUp] = useState<ChogRecord | null>(null);
  const fixturesOn = import.meta.env.VITE_FIXTURES === "1";

  useEffect(() => {
    const source = getGameSource();
    if (!source) return;
    setSourceLabel(
      source.kind === "fixture"
        ? "DEV FIXTURE · SIMULATED SCHEDULE · NOT PRODUCTION DATA"
        : "LIVE FROM THE POOL CONTRACT (nextDrawAt)",
    );
    void source.nextDrawAt().then(setNextDrawAt);
    void source.potBalance().then(setPot);
  }, []);

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <Badge tone="accent">MONAD TESTNET · LIVE BUILD</Badge>
          <p className="kicker">SAVE TO RACE</p>
          <h1>Your Chog is<br /><em>on the track.</em></h1>
          <p className="lede">A savings game for Chog holders. Your deposit stays yours. The yield becomes the race.</p>
          <div className="hero-actions">
            <Button onClick={() => navigate("/deposit")}>Enter the track</Button>
            <Button variant="quiet" onClick={() => navigate("/spectator")}>Watch the next race <span>↗</span></Button>
          </div>
        </div>

        <Panel className="track-card">
          <div className="card-top">
            <span>GRAND PRIX</span>
            <Badge tone="neutral">UI PREVIEW</Badge>
          </div>
          <Countdown nextDrawAt={nextDrawAt} sourceLabel={sourceLabel} />
          <div className="lane lane-one"><div className="lane-label">01 <span>CHOG #1462</span></div><div className="runner runner-one">◉</div></div>
          <div className="lane lane-two"><div className="lane-label">02 <span>CHOG #1</span></div><div className="runner runner-two">◉</div></div>
          <div className="lane lane-three"><div className="lane-label">03 <span>CHOG #954</span></div><div className="runner runner-three">◉</div></div>
          <div className="track-footer"><span>PRIZE POT</span><strong>{pot === null ? "Yield accumulates live" : `${formatUnits(pot, POT_DECIMALS)} USDC${fixturesOn ? " (fixture)" : ""}`}</strong><span>↗</span></div>
          <p className="track-note">Design preview of the race UI (Phase 3). Lanes are illustrative. No race is running.</p>
        </Panel>
      </section>

      <Marquee items={["REAL YIELD ONLY", "PRINCIPAL WITHDRAWABLE ANY TIME", "PUBLISHED SEED · RE-VERIFIABLE", "TEST DRIVE AVAILABLE", "MONAD TESTNET"]} tone="accent" />

      <section className="proof-grid">
        <div>
          <p className="kicker">THE PROMISE</p>
          <h2>Your dollars never enter the race.</h2>
          <p className="muted">The track only competes with yield. Withdraw your principal at any time. Rewards scale with the pool.</p>
        </div>
        <Panel className="proof-panel">
          <Stat label="NEXT DRAW" value={nextDrawAt ? "Counting down" : "Not scheduled yet"} note="Cadence comes from the pool contract (nextDrawAt), never from copy." />
          <Stat label="FAIRNESS" value="Published seed" note="Winner re-derivable from the published seed on the verifier page." tone="lime" />
        </Panel>
        <Panel className="proof-panel">
          <Stat label="TRY IT NOW" value="Test Drive" note="No Chog? Claim one clearly-labeled Test Chog and use the full site." tone="accent" />
          <Button variant="quiet" onClick={() => navigate("/deposit")}>Open the deposit flow ↗</Button>
        </Panel>
      </section>

      <section className="viewer-section">
        <ChogViewer onRecord={setLookedUp} />
      </section>

      <section className="share-section">
        <ShareCard
          chog={lookedUp ? {
            tokenId: lookedUp.tokenId.toString(),
            imageUrl: lookedUp.metadata.image ? ipfsToGateway(lookedUp.metadata.image) : null,
            name: lookedUp.metadata.name ?? `Chog #${lookedUp.tokenId.toString()}`,
          } : null}
          raceLabel={nextDrawAt ? "Next race counting down" : "Race schedule pending"}
        />
      </section>

      <section className="style-panel">
        <p className="kicker">PHASE 2 · DESIGN BASE</p>
        <h2>Built for proof, designed for play.</h2>
        <div className="token-row">
          <span style={{ background: tokens.color.accent }} />
          <span style={{ background: tokens.color.lime }} />
          <span style={{ background: tokens.color.raised }} />
          <span style={{ background: tokens.color.ink }} />
        </div>
        <p className="muted">Every race is a deterministic replay of an on-chain result. The verifier is part of the experience, not a footnote.</p>
        <Button variant="outline" onClick={() => navigate("/style")}>Open the style guide</Button>
        {fixturesOn && <Badge tone="danger">DEV FIXTURE MODE ACTIVE (VITE_FIXTURES=1)</Badge>}
      </section>

      <Card title="Honest boundaries" footer="LABEL DISCIPLINE IS A RULES.md CLAUSE">
        <ul className="rules-list">
          <li>Test Drive Chogs are clearly labeled everywhere. They never blur into Verified Holder status.</li>
          <li>Traits are real off-chain IPFS metadata. Any boost mapping is our design, derived from real traits.</li>
          <li>Deposits are principal-safe by design, not by guarantee. Yield sources carry their own risks.</li>
        </ul>
      </Card>
    </>
  );
}
