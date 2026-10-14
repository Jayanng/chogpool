import { Badge, Button, Panel, tokens, UI_VERSION } from "@chogpool/ui";

export function StyleGuide() {
  return <main style={{ background: tokens.color.ground, color: tokens.color.ink, minHeight: "100vh", padding: 40, fontFamily: "system-ui" }}>
    <p style={{ color: tokens.color.accent }}>CHOG TRACK · DESIGN SYSTEM v{UI_VERSION}</p>
    <h1>Style guide</h1>
    <Panel><h2>Buttons</h2><Button>Primary action</Button> <Button variant="quiet">Quiet action</Button> <Button variant="outline">Outlined action</Button></Panel>
    <Panel><h2>Badges</h2><Badge tone="accent">TEST DRIVE</Badge> <Badge tone="lime">LIVE</Badge> <Badge>VERIFIED HOLDER</Badge></Panel>
    <Panel><h2>Tokens</h2><pre>{JSON.stringify(tokens, null, 2)}</pre></Panel>
  </main>;
}
