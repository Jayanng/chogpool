import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { Badge, Button, Card, Marquee, Panel, Stat, tokens } from "@chogpool/ui";
import { ChogViewer } from "../components/ChogViewer";
import { ShareCard } from "../components/ShareCard";
import { getGameSource } from "../lib/game";
import { readPodium, type PodiumRow } from "../lib/board";
import { CHAIN } from "../generated/addresses.gen";
import { POT_DECIMALS } from "../types/game";
import { ipfsToGateway, type ChogRecord } from "../lib/chog";
import { navigate } from "../lib/router";
import tileCrowned from "./assets/c100.webp";
import tileHoodie from "./assets/c25.webp";

export default function Landing() {
  const [pot, setPot] = useState<bigint | null>(null);
  const [lookedUp, setLookedUp] = useState<ChogRecord | null>(null);
  // The leaderboard's podium, read live from the CareerStore. null while
  // reading or after a failed read (said as such, never shown as empty),
  // [] when the board is genuinely empty. A row exists only when the store
  // recorded it.
  const [board, setBoard] = useState<PodiumRow[] | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);
  const fixturesOn = import.meta.env.VITE_FIXTURES === "1";

  useEffect(() => {
    const source = getGameSource();
    if (!source) return;
    void source.potBalance().then(setPot);
  }, []);

  useEffect(() => {
    void readPodium()
      .then(setBoard)
      .catch(() => setBoardFailed(true));
  }, []);

  const placeName = (place: number) => {
    if (boardFailed) return "BOARD UNREADABLE";
    if (board === null) return "READING…";
    const row = board.find((r) => r.place === place);
    return row ? `CHOG #${row.tokenId.toString()}` : "OPEN";
  };

  return (
    <div className="landing">
      <section className="hero hero-scene">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-confetti" aria-hidden="true">
          <svg style={{ left: "360px", top: "8px", width: "58px" }} viewBox="0 0 24 24" fill="#ffd84d"><path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z" /></svg>
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
            <span className="pill pill-dark">Skill game on Monad</span>
            <span className="pill pill-light">Test funds only</span>
          </div>
          <h1>Your stake stays yours.<br />Your skill <em>wins the pot.</em></h1>
          <p className="lede">A skill game for Chog holders. Enter with a stake, run the seeded course, and the top 3 split the pot. Your stake stays withdrawable, and every run is checkable by anyone.</p>
          <div className="hero-actions">
            <Button onClick={() => navigate("/run")}>Play the game →</Button>
            <Button variant="quiet" onClick={() => navigate("/deposit")}>Open the app</Button>
            <Button variant="quiet" onClick={() => navigate("/race")}>See a real draw</Button>
          </div>
          <div className="trust-row">
            <span className="chip"><span className="dot dot-green" />Principal safe</span>
            <span className="chip"><span className="dot dot-pink" />Real yield only</span>
            <span className="chip"><span className="dot dot-yellow" />Re-derivable</span>
          </div>
        </div>

        <div className="hero-stage">
          <div className="sticker sticker-lg"><img src={tileCrowned} alt="Chog #100 from the Chog Genesis collection, crowned" /></div>
          <div className="sticker sticker-sm"><img src={tileHoodie} alt="Chog #25 from the Chog Genesis collection in a pink hood" /></div>
        </div>
      </section>

      <section className="hero-live">
        <Panel className="track-card">
          <div className="card-top">
            <span>GRAND PRIX</span>
            <Badge tone="neutral">THE LEADERBOARD</Badge>
          </div>
          <div className="lane lane-one"><div className="lane-label">1ST <span>{placeName(1)}</span></div><div className="runner runner-one">◉</div></div>
          <div className="lane lane-two"><div className="lane-label">2ND <span>{placeName(2)}</span></div><div className="runner runner-two">◉</div></div>
          <div className="lane lane-three"><div className="lane-label">3RD <span>{placeName(3)}</span></div><div className="runner runner-three">◉</div></div>
          <div className="track-footer"><span>PRIZE POT</span><strong>{pot === null ? "Reading the chain…" : `${formatUnits(pot, POT_DECIMALS)} USDC${fixturesOn ? " (fixture)" : ""}`}</strong><span>↗</span></div>
          <p className="track-note">The board reads the career store's on-chain record. The round's top 3 land here the moment it settles.</p>
          <Button onClick={() => navigate("/run")}>Play the game</Button>
        </Panel>
      </section>

      <Marquee items={["REAL YIELD ONLY", "PRINCIPAL WITHDRAWABLE ANY TIME", "PUBLISHED SEED · RE-VERIFIABLE", "TEST DRIVE AVAILABLE"]} tone="accent" />

      <section className="proof-grid">
        <div>
          <p className="kicker">THE PROMISE</p>
          <h2>Safe by design, checkable by anyone.</h2>
          <p className="muted">Your stake stays yours and stays withdrawable. The top 3 split the pot, and every run is checkable by anyone.</p>
        </div>
        <Panel className="proof-panel">
          <Stat label="THE LEADERBOARD" value="Top 3 split the pot" note="Rounds open, lock and settle on their own schedule. The podium lands on the board." />
          <Stat label="FAIRNESS" value="Published seed" note="Run re-derivable from its published seed and inputs on the verifier page." tone="lime" />
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
          raceLabel="Chog Grand Prix"
        />
      </section>

      <section className="style-panel">
        <p className="kicker">THE FAIRNESS LAYER</p>
        <h2>Built for proof, designed for play.</h2>
        <p className="muted">Every race is a deterministic replay of an on-chain result. The verifier is part of the experience, not a footnote.</p>
        {fixturesOn && <Badge tone="danger">DEV FIXTURE MODE · SIMULATED DATA</Badge>}
      </section>

      <Card title="Honest boundaries" footer="CLEAR LABELS, ALWAYS">
        <ul className="rules-list">
          <li>Test Drive Chogs are clearly labeled everywhere. They never blur into Verified Holder status.</li>
          <li>Traits are real off-chain IPFS metadata. Any boost mapping is our design, derived from real traits.</li>
          <li>The UI only visualizes what the contracts record. It never infers or invents a winner.</li>
        </ul>
      </Card>
    </div>
  );
}
