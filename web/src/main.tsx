import { createRoot } from "react-dom/client";
import { Badge, Button, Panel, UI_VERSION, tokens } from "@chogpool/ui";
import { CHAIN, MAINNET, TESTNET } from "./generated/addresses.gen";
import "./styles.css";

const nav = ["Track", "Spectate", "Verify"];

function App() {
  return (
    <main className="app-shell">
      <nav className="topbar">
        <a className="brand" href="/">CHOG<span>TRACK</span></a>
        <div className="nav-links">{nav.map((item) => <a href={`#${item.toLowerCase()}`} key={item}>{item}</a>)}</div>
        <Button variant="outline">Connect wallet</Button>
      </nav>

      <section className="hero" id="track">
        <div className="hero-copy">
          <Badge tone="accent">MONAD TESTNET · LIVE BUILD</Badge>
          <p className="kicker">SAVE TO RACE</p>
          <h1>Your Chog is<br /><em>on the track.</em></h1>
          <p className="lede">A savings game for Chog holders. Your deposit stays yours. The yield becomes the race.</p>
          <div className="hero-actions"><Button>Enter the track</Button><Button variant="quiet">Watch the next race <span>↗</span></Button></div>
          <div className="network-note"><span className="status-dot" /> Read: {CHAIN.monad.name} · Play: {CHAIN.monadTestnet.name}</div>
        </div>
        <Panel className="track-card">
          <div className="card-top"><span>GRAND PRIX · IN 02:14:08</span><Badge tone="lime">TEST MODE</Badge></div>
          <div className="lane lane-one"><div className="lane-label">01 <span>CHOG #1462</span></div><div className="runner runner-one">◉</div></div>
          <div className="lane lane-two"><div className="lane-label">02 <span>CHOG #1</span></div><div className="runner runner-two">◉</div></div>
          <div className="lane lane-three"><div className="lane-label">03 <span>CHOG #954</span></div><div className="runner runner-three">◉</div></div>
          <div className="track-footer"><span>PRIZE POT</span><strong>Yield accumulates live</strong><span>↗</span></div>
        </Panel>
      </section>

      <section className="proof-grid" id="spectate">
        <div><p className="kicker">THE PROMISE</p><h2>Your dollars never enter the race.</h2><p className="muted">The track only competes with yield. Withdraw your principal at any time. Rewards scale with the pool.</p></div>
        <Panel><div className="metric-label">NEXT DRAW</div><div className="metric-value">Every week</div><div className="metric-line" /><div className="metric-label">FAIRNESS</div><div className="metric-value small">Published seed · re-verifiable</div></Panel>
        <Panel><div className="metric-label">TRY IT NOW</div><div className="metric-value small">No Chog? Start a labeled Test Drive.</div><Button variant="quiet">Mint Test Chog ↗</Button></Panel>
      </section>

      <section className="style-panel" id="verify"><p className="kicker">PHASE 2 · DESIGN BASE v{UI_VERSION}</p><h2>Built for proof, designed for play.</h2><div className="token-row"><span style={{ background: tokens.color.accent }} /><span style={{ background: tokens.color.lime }} /><span style={{ background: tokens.color.raised }} /><span style={{ background: tokens.color.ink }} /></div><p className="muted">Every race is a deterministic replay of an on-chain result. The verifier is part of the experience, not a footnote.</p></section>
    </main>
  );
}

void MAINNET; void TESTNET;
createRoot(document.getElementById("root")!).render(<App />);
