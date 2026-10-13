# WORKING AGREEMENT — Jayanng + teammate

## Zones (directory ownership)
- **teammate owns:** `contracts/` (all), `web/src/money/`, `web/src/identity/`, `infra/deployments.json` (deploy outputs)
- **Jayanng owns:** `packages/ui/` (design system), `web/src/race/`, `web/src/draft/`, `web/src/design/`, `scripts/video/`
- **Shared (changes need a heads-up in chat):** `web/src/App.tsx`, `web/src/lib/`, `package.json` roots, `infra/verified.json` (both must approve any new address: source required)

## The interfaces folder is law
- `contracts/interfaces/*.sol` and any frozen TS types under `web/src/types/` are the contract between us.
- Changing any frozen interface requires BOTH approvals on the PR.
- Everything else can move freely inside your own zones.

## Branching
- Trunk-based: `main` is always green (CI).
- Feature branches `feat/<zone>-<thing>`, lifetime ≤ 2 days, merged via PR.
- The other person's coding agent reviews first (against docs/RULES.md and the phase gate), then a human glance.
- No long-lived parallel branches.

## The design system
- `packages/ui` is versioned (v0.x). Screens import from `@chogpool/ui`, never write raw tokens.
- Jayanng iterates on ui freely; breaking changes bump minor + a style-guide check; teammate upgrades deliberately (`pnpm --filter web up @chogpool/ui`).
- Style guide lives at `/style` route, rendered from the real tokens.

## CI / environment
- CI runs in GitHub Actions only — never on our 2-CPU VPS.
- `forge build && forge test` (contracts), `node infra/check-addresses.mjs` (registry), `pnpm run build:web` (web).
- The VPS is for: orchestration, demo video capture, local anvil fork rehearsals.
- Address rule: any new address must be added to `infra/verified.json` WITH a source + date, then `node infra/gen-addresses.mjs` regenerates the TS module. Never inline.

## Daily sync
- One async check-in message per day: what changed on shared surfaces (interfaces, verified.json, ui versions). Silence = nothing shared changed.

## Tiebreaker
- Disagreements on shared surfaces: Jayanng decides. Design final say: Jayanng. Contracts correctness final say: teammate. Factual accuracy (addresses, chain behavior): the registry + live verification, not opinions.

## Gates
- Every phase gate: shared tests green in CI + both humans confirm the integrated slice + record in docs/DECISIONS.md before the next phase starts.
- Submission: user (Jayanng) manually verifies the app + video and approves before anything is submitted (standing rule).
