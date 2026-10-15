import { Badge, Button, Card, Panel } from "@chogpool/ui";
import { navigate } from "../lib/router";

export default function Verify() {
  return (
    <>
      <section className="page-head">
        <p className="kicker">FAIRNESS VERIFIER</p>
        <h1>Trust the math,<br /><em>then check it.</em></h1>
        <p className="lede">
          Paste a race ID and the verifier re-derives the winner from the published seed using the exact
          on-chain formula. Green check when it matches the on-chain record.
        </p>
        <Badge tone="neutral">PHASE 3 · UNDER CONSTRUCTION</Badge>
      </section>

      <Panel className="feature-panel">
        <Card title="Verifier" footer="KECCAK256(DRAWID, TOKENID, TIER, PACKEDPARAMS, FINALRANDOMNESS) MOD TOTALTICKETS">
          <label className="field">
            <span>RACE ID</span>
            <input placeholder="Available after the first draw" disabled />
          </label>
          <Button disabled>Recompute winner</Button>
          <p className="muted">
            The verifier lands with the draw engine (Phase 3). The formula above is the frozen one from
            the plan. The page recomputes exactly this, step by step, from the published seed.
          </p>
          <Button variant="outline" onClick={() => navigate("/")}>Back to the track</Button>
        </Card>
      </Panel>
    </>
  );
}
