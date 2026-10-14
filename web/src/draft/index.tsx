import { Badge, Card, Panel } from "@chogpool/ui";

export default function Draft() {
  return (
    <>
      <section className="page-head">
        <p className="kicker">DRAFT NIGHT</p>
        <h1>Pick your perk.</h1>
        <p className="lede">
          Before each race, pick 1-of-3 trait-derived perks. Perks are cosmetic pace flavor within the
          capped boost and side prizes only — they never change the on-chain winner.
        </p>
        <Badge tone="neutral">PHASE 3 · UNDER CONSTRUCTION</Badge>
      </section>
      <Panel className="feature-panel">
        <Card title="What lands here" footer="ON-CHAIN TRUTH VS SHOW LAYER IS DOCUMENTED IN RULES.md">
          <ul className="rules-list">
            <li>Three real trait-derived perks per Chog, presented pre-race.</li>
            <li>Perks never touch the draw math: the winner is fixed on-chain.</li>
            <li>A small Test $CHOG side prize for "best-dressed", voted by spectators.</li>
          </ul>
        </Card>
      </Panel>
    </>
  );
}
