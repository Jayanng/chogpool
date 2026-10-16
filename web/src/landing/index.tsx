import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { Badge, Button, Card, Marquee, Panel, Stat, tokens } from "@chogpool/ui";
import { ChogViewer } from "../components/ChogViewer";
import { Countdown } from "../components/Countdown";
import { ShareCard } from "../components/ShareCard";
import { getGameSource, getRaceSource } from "../lib/game";
import { CHAIN } from "../generated/addresses.gen";
import { POT_DECIMALS } from "../types/game";
import { ipfsToGateway, type ChogRecord } from "../lib/chog";
import { navigate } from "../lib/router";
import tileCrowned from "./assets/c100.webp";
import tileHoodie from "./assets/c25.webp";
import tileBandana from "./assets/c40.webp";

export default function Landing() {
  const [nextDrawAt, setNextDrawAt] = useState<number | null>(null);
  const [pot, setPot] = useState<bigint | null>(null);
  const [sourceLabel, setSourceLabel] = useState("FROM THE GAME SOURCE (nextDrawAt)");
  const [lookedUp, setLookedUp] = useState<ChogRecord | null>(null);
  // Whether the current draw's field already locked on chain (the draw is
  // closed or awarded). Unknown until the draw's state is read.
  const [fieldLocked, setFieldLocked] = useState<boolean | null>(null);
  // Preview lane names come from the real current draw when one exists; a
  // null lane renders as a clear placeholder, never an invented tokenId.
  const [previewLanes, setPreviewLanes] = useState<Array<string | null>>([null, null, null]);
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

  useEffect(() => {
    const source = getRaceSource();
    if (!source) return;
    void (async () => {
      try {
        const id = await source.currentDrawId();
        const draw = id === null ? null : await source.getDraw(id);
        const ids = (draw?.racers ?? []).slice(0, 3).map((r) => r.tokenId.toString());
        setPreviewLanes([ids[0] ?? null, ids[1] ?? null, ids[2] ?? null]);
        setFieldLocked(draw ? draw.state !== "open" : null);
      } catch {
        // No draw readable: the lanes stay generic placeholders and the
        // countdown makes no claim about the field being locked.
        setFieldLocked(null);
      }
    })();
  }, []);

  return (
    <>
      <section className="hero hero-scene">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-copy">
          <Badge tone="accent">MONAD TESTNET · LIVE BUILD</Badge>
          <p className="kicker">SAVE TO RACE</p>
          <h1>Your Chog is<br /><em>on the track.</em></h1>
          <div className="catchphrase">Your dollars never enter the race.</div>
          <p className="lede">A savings game for Chog holders. Your deposit stays yours. The yield becomes the race.</p>
          <div className="hero-actions">
            <Button onClick={() => navigate("/deposit")}>Enter the track</Button>
            <Button variant="quiet" onClick={() => navigate("/spectator")}>Watch the next race <span>↗</span></Button>
          </div>
        </div>

        <div className="hero-stage">
          <img className="hero-tile tile-crowned" src={tileCrowned} alt="Chog #100 from the Chog Genesis collection, crowned" />
          <img className="hero-tile tile-hoodie" src={tileHoodie} alt="Chog #25 from the Chog Genesis collection in a pink hood" />
          <img className="hero-tile tile-third" src={tileBandana} alt="A bandana-wearing Chog from the Chog Genesis collection" />
          <Panel className="track-card">
          <div className="card-top">
            <span>GRAND PRIX</span>
            <Badge tone="neutral">UI PREVIEW</Badge>
          </div>
          <Countdown nextDrawAt={nextDrawAt} sourceLabel={sourceLabel} fieldLocked={fieldLocked} />
          <div className="lane lane-one"><div className="lane-label">01 <span>{previewLanes[0] ? `CHOG #${previewLanes[0]}` : "ANY CHOG"}</span></div><div className="runner runner-one">◉</div></div>
          <div className="lane lane-two"><div className="lane-label">02 <span>{previewLanes[1] ? `CHOG #${previewLanes[1]}` : "ANY CHOG"}</span></div><div className="runner runner-two">◉</div></div>
          <div className="lane lane-three"><div className="lane-label">03 <span>{previewLanes[2] ? `CHOG #${previewLanes[2]}` : "ANY CHOG"}</span></div><div className="runner runner-three">◉</div></div>
          <div className="track-footer"><span>PRIZE POT</span><strong>{pot === null ? "Yield accumulates live" : `${formatUnits(pot, POT_DECIMALS)} USDC${fixturesOn ? " (fixture)" : ""}`}</strong><span>↗</span></div>
          <p className="track-note">A preview of the race experience. Lane names come from the current draw when one exists and are placeholders otherwise. No race is running.</p>
        </Panel>
        </div>
      </section>

      <Marquee items={["REAL YIELD ONLY", "PRINCIPAL WITHDRAWABLE ANY TIME", "PUBLISHED SEED · RE-VERIFIABLE", "TEST DRIVE AVAILABLE"]} tone="accent" />

      <section className="proof-grid">
        <div>
          <p className="kicker">THE PROMISE</p>
          <h2>Your dollars never enter the race.</h2>
          <p className="muted">The track only competes with yield. Withdraw your principal at any time. Rewards scale with the pool.</p>
        </div>
        <Panel className="proof-panel">
          <Stat label="NEXT DRAW" value={nextDrawAt ? "Counting down" : "Not scheduled yet"} note="Draws are opened on chain by the operator: no timer, no promised cadence." />
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
        <p className="kicker">BUILT FOR PROOF</p>
        <h2>Built for proof, designed for play.</h2>
        <p className="muted">Every race is a deterministic replay of an on-chain result. The verifier is part of the experience, not a footnote.</p>
        {fixturesOn && <Badge tone="danger">DEV FIXTURE MODE · SIMULATED DATA</Badge>}
      </section>

      <Card title="Honest boundaries" footer="CLEAR LABELS, ALWAYS">
        <ul className="rules-list">
          <li>Test Drive Chogs are clearly labeled everywhere. They never blur into Verified Holder status.</li>
          <li>Traits are real off-chain IPFS metadata. Any boost mapping is our design, derived from real traits.</li>
          <li>Deposits are principal-safe by design, not by guarantee. Yield sources carry their own risks.</li>
        </ul>
      </Card>
    </>
  );
}
