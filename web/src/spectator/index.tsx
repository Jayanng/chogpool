import { Badge, Button, Card, Panel } from "@chogpool/ui";
import { navigate } from "../lib/router";

export default function Spectator() {
  return (
    <>
      <section className="page-head">
        <p className="kicker">SPECTATOR MODE</p>
        <h1>Watch without a wallet.</h1>
        <p className="lede">
          Every race is viewable with no wallet and no deposit. Cheer with Test $CHOG tips that feed the
          bonus pot. Not a holder? A clearly-labeled Test Drive gets you in the experience today.
        </p>
        <Badge tone="neutral">PHASE 3 · UNDER CONSTRUCTION</Badge>
      </section>

      <Panel className="feature-panel">
        <Card title="What lands here" footer="TEST DRIVE IS TESTNET-ONLY AND CLEARLY LABELED">
          <ul className="rules-list">
            <li>Live race view with no wallet connection required.</li>
            <li>Cheer with Test $CHOG tips feeding the bonus pot.</li>
            <li>"Get a Chog" CTA for non-holders, honest about Test Drive labels.</li>
          </ul>
          <div className="hero-actions">
            <Button onClick={() => navigate("/deposit")}>Open the deposit flow</Button>
            <Button variant="quiet" onClick={() => navigate("/")}>Back to the track</Button>
          </div>
        </Card>
      </Panel>
    </>
  );
}
