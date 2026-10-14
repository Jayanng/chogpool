import {
  Badge,
  Button,
  Card,
  Marquee,
  Panel,
  Skeleton,
  Stat,
  Toast,
  tokens,
  UI_VERSION,
} from "@chogpool/ui";
import { navigate } from "./lib/router";

const colorRows = Object.entries(tokens.color);
const radiusRows = Object.entries(tokens.radius);
const spaceRows = Object.entries(tokens.space);
const motionRows = [
  ["fast", tokens.motion.fast],
  ["base", tokens.motion.base],
  ["slow", tokens.motion.slow],
  ["spring.snappy", tokens.motion.spring.snappy],
  ["spring.smooth", tokens.motion.spring.smooth],
  ["spring.settle", tokens.motion.spring.settle],
] as const;

export default function StyleGuide() {
  return (
    <>
      <section className="page-head">
        <p className="kicker">CHOG TRACK · DESIGN SYSTEM v{UI_VERSION}</p>
        <h1>Style guide</h1>
        <p className="lede">Every component and token of packages/ui, rendered with real values. Graphite ground, track-orange signal, lane-lime confirm.</p>
        <Button variant="outline" onClick={() => navigate("/")}>Back to the track</Button>
      </section>

      <Panel className="guide-section">
        <h2>Buttons</h2>
        <div className="guide-row">
          <Button>Primary action</Button>
          <Button variant="quiet">Quiet action</Button>
          <Button variant="outline">Outlined action</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Panel>

      <Panel className="guide-section">
        <h2>Badges</h2>
        <div className="guide-row">
          <Badge tone="neutral">VERIFIED HOLDER</Badge>
          <Badge tone="accent">TEST DRIVE</Badge>
          <Badge tone="lime">LIVE</Badge>
          <Badge tone="danger">NO WALLET</Badge>
        </div>
      </Panel>

      <Panel className="guide-section">
        <h2>Cards</h2>
        <div className="guide-grid">
          <Card title="Card title" aside={<Badge tone="accent">ASIDE</Badge>} footer="FOOTER NOTE">
            Card body copy sits here. Real Chog data only, never invented traits.
          </Card>
          <Card title="Card with actions" footer="FOOTER NOTE">
            <Button variant="outline">Action</Button>
          </Card>
        </div>
      </Panel>

      <Panel className="guide-section">
        <h2>Stats</h2>
        <div className="guide-grid">
          <Stat label="NEXT DRAW" value="Not scheduled yet" note="Cadence comes from the contract." />
          <Stat label="POT" value="Yield-driven" note="Grows only from realized yield." tone="accent" />
          <Stat label="FAIRNESS" value="Published seed" note="Re-verifiable end to end." tone="lime" />
        </div>
      </Panel>

      <Panel className="guide-section">
        <h2>Marquee</h2>
        <Marquee items={["REAL YIELD ONLY", "PUBLISHED SEED", "PRINCIPAL WITHDRAWABLE", "TEST DRIVE AVAILABLE"]} tone="accent" />
      </Panel>

      <Panel className="guide-section">
        <h2>Toasts</h2>
        <div className="guide-row">
          <Toast tone="info" message="Info: fixture mode active." />
          <Toast tone="success" message="Success: deposit recorded (fixture)." />
          <Toast tone="danger" message="Error: enter a Chog ID from 1 to 1,969." />
        </div>
      </Panel>

      <Panel className="guide-section">
        <h2>Skeletons</h2>
        <div className="guide-row">
          <Skeleton variant="text" />
          <Skeleton variant="text" width={220} />
          <Skeleton variant="circle" />
          <Skeleton variant="block" />
        </div>
      </Panel>

      <Panel className="guide-section">
        <h2>Color tokens</h2>
        <div className="swatch-grid">
          {colorRows.map(([name, value]) => (
            <div className="swatch" key={name}>
              <span className="swatch-chip" style={{ background: value }} />
              <code>{name}</code>
              <code className="swatch-value">{value}</code>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="guide-section">
        <h2>Radius & spacing</h2>
        <div className="guide-row">
          {radiusRows.map(([name, value]) => (
            <div className="radius-demo" key={name} style={{ borderRadius: value }}>
              <code>radius.{name} · {value}</code>
            </div>
          ))}
        </div>
        <div className="guide-row">
          {spaceRows.map(([name, value]) => (
            <div className="space-demo" key={name}>
              <span style={{ width: value, height: value }} />
              <code>space.{name} · {value}</code>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="guide-section">
        <h2>Typography</h2>
        <p className="type-sans">Plus Jakarta Sans — the voice of the product. Fallback: Manrope, system-ui.</p>
        <p className="type-mono">DM Mono — kickers, labels, addresses, countdowns.</p>
        <p style={{ fontSize: tokens.type.scale.h2, fontWeight: 700, letterSpacing: "-.03em", margin: "8px 0" }}>Heading scale {tokens.type.scale.h2}</p>
        <p style={{ fontSize: tokens.type.scale.body, color: tokens.color.muted }}>Body {tokens.type.scale.body} · muted ink</p>
        <p className="kicker" style={{ margin: "8px 0" }}>KICKER {tokens.type.scale.kicker}</p>
      </Panel>

      <Panel className="guide-section">
        <h2>Motion tokens</h2>
        <div className="guide-row">
          {motionRows.map(([name, value]) => (
            <code className="motion-chip" key={name}>{name} · {value}</code>
          ))}
        </div>
        <div className="guide-row">
          <div className="motion-demo motion-demo--snappy" />
          <div className="motion-demo motion-demo--smooth" />
          <div className="motion-demo motion-demo--settle" />
        </div>
      </Panel>
    </>
  );
}
