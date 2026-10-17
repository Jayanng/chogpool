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
    <div className="landing">
      <section className="hero hero-scene">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-confetti" aria-hidden="true">
          <svg style={{ left: "28px", top: "12px", width: "58px" }} viewBox="0 0 24 24" fill="#ffd84d"><path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z" /></svg>
          <svg style={{ left: "250px", top: "26px", width: "34px" }} viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#f3a0c9" /></svg>
          <svg style={{ left: "452px", top: "10px", width: "122px" }} viewBox="0 0 60 30" fill="none"><path d="M4 22 Q 16 4, 28 22 T 52 22" stroke="#fff" strokeWidth="9" strokeLinecap="round" /></svg>
          <svg style={{ left: "700px", top: "24px", width: "34px" }} viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#ff2d87" /></svg>
          <svg style={{ left: "1072px", top: "16px", width: "62px" }} viewBox="0 0 24 24" fill="#fff"><path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z" /></svg>
          <svg style={{ left: "792px", top: "232px", width: "54px" }} viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke="#f3a0c9" strokeWidth="5" fill="none" /></svg>
          <svg style={{ left: "766px", top: "20px", width: "38px" }} viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#ffd84d" /></svg>
          <svg style={{ left: "884px", top: "26px", width: "32px" }} viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#ff2d87" /></svg>
        </div>
        <div className="hero-copy">
          <div className="hero-chips">
            <span className="pill pill-dark">Prize savings on Monad</span>
            <span className="pill pill-light">Test funds only</span>
          </div>
          <h1>Your dollars<br />never enter<br />the <em>race.</em></h1>
          <p className="lede">A savings game for Chog holders. Your deposit stays yours and stays withdrawable. Only the yield competes, and every draw is checkable by anyone.</p>
          <div className="hero-actions">
            <Button onClick={() => navigate("/deposit")}>Open the app →</Button>
            <Button variant="quiet" onClick={() => navigate("/race")}>See a real draw</Button>
          </div>
          <div className="trust-row">
            <span className="chip"><span className="dot dot-green" />Principal withdrawable any time</span>
            <span className="chip"><span className="dot dot-pink" />Real yield only</span>
            <span className="chip"><span className="dot dot-yellow" />Re-derivable draws</span>
          </div>
        </div>

        <div className="hero-stage">
          <div className="sticker sticker-lg"><img src={tileCrowned} alt="Chog #100 from the Chog Genesis collection, crowned" /></div>
          <div className="sticker sticker-sm"><img src={tileHoodie} alt="Chog #25 from the Chog Genesis collection in a pink hood" /></div>
          <div className="float-pill fp-odds"><b>98.37%</b> odds</div>
          <div className="float-pill fp-final"><span className="dot dot-green" />Race 01 finalized</div>
          <div className="float-pill fp-paid"><b>0.000819</b> USDC paid</div>
        </div>
      </section>

      <section className="hero-live">
        <Panel className="track-card">
          <div className="card-top">
            <span>GRAND PRIX</span>
            <Badge tone="neutral">RACE PREVIEW</Badge>
          </div>
          <Countdown nextDrawAt={nextDrawAt} sourceLabel={sourceLabel} fieldLocked={fieldLocked} />
          <div className="lane lane-one"><div className="lane-label">01 <span>{previewLanes[0] ? `CHOG #${previewLanes[0]}` : "ANY CHOG"}</span></div><div className="runner runner-one">◉</div></div>
          <div className="lane lane-two"><div className="lane-label">02 <span>{previewLanes[1] ? `CHOG #${previewLanes[1]}` : "ANY CHOG"}</span></div><div className="runner runner-two">◉</div></div>
          <div className="lane lane-three"><div className="lane-label">03 <span>{previewLanes[2] ? `CHOG #${previewLanes[2]}` : "ANY CHOG"}</span></div><div className="runner runner-three">◉</div></div>
          <div className="track-footer"><span>PRIZE POT</span><strong>{pot === null ? "Yield accumulates live" : `${formatUnits(pot, POT_DECIMALS)} USDC${fixturesOn ? " (fixture)" : ""}`}</strong><span>↗</span></div>
          <p className="track-note">A preview of the race experience. Lane names come from the current draw when one exists and are placeholders otherwise. No race is running.</p>
        </Panel>
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
    </div>
  );
}
