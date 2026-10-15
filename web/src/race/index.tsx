import { Badge, Button, Card, Panel } from "@chogpool/ui";
import { navigate } from "../lib/router";

export default function Race() {
  return (
    <>
      <section className="page-head">
        <p className="kicker">THE RACE</p>
        <h1>One seed.<br /><em>One result. One show.</em></h1>
        <p className="lede">
          The race animation is a deterministic replay of the on-chain draw result, never a source of it.
          Same seed, same result, same animation, every time.
        </p>
        <Badge tone="neutral">PHASE 3 · UNDER CONSTRUCTION</Badge>
      </section>

      <Panel className="feature-panel">
        <Card title="What lands here" footer="SEE docs/PLAN.md PHASE 3">
          <ul className="rules-list">
            <li>Countdown → gates open → lanes with real Chog images → photo finish → podium.</li>
            <li>Trait-driven pace presentation with the boost capped, presentation only.</li>
            <li>The on-chain draw result is the single source of truth for the winner.</li>
            <li>Share card with the real winner and pot after each draw.</li>
          </ul>
          <div className="hero-actions">
            <Button variant="outline" onClick={() => navigate("/verify")}>See the fairness verifier</Button>
            <Button variant="quiet" onClick={() => navigate("/")}>Back to the track</Button>
          </div>
        </Card>
      </Panel>
    </>
  );
}
