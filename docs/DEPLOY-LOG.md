# Deploy Log

## 2026-10-14: design system + app shell · production

- URL (canonical): https://chogpool.vercel.app
- Vercel project: chogpool (`prj_V91WdA7r5uRTE5aAJpko4e1x09Q4`, team jayanng)
- Deployment id: `dpl_HnVgyRgTCs1Exq6uXDyjWv362VQJ`
- Commit served: `56c824b` (meta.githubCommitSha matched `git ls-remote origin main`)
- Mode: git-linked to `Jayanng/chogpool` (production branch `main`), auto-deploy on push
- Build on Vercel: `node infra/gen-addresses.mjs && pnpm run build:web && node infra/check-fixtures.mjs`, output `web/dist` (fixture check is part of the cloud build)
- vercel.json: SPA rewrite `/(.*)` → `/index.html` (client-side routes: /, /deposit, /race, /draft, /verify, /spectator, /style)

### Verified after deploy (2026-10-14)

- All 7 routes on the canonical domain return 200 with the app shell.
- Deployed JS chunks scanned for fixture markers/sentinel: 0 hits (production bundle is fixture-free; the same check also gates the cloud build).
- Real-browser pass on https://chogpool.vercel.app (headless Chromium over CDP):
  - all 7 routes render their expected content;
  - Chog lookup (token 1462) returns real Monad mainnet data: owner `0x8CcFAA2C…6d94`, tokenURI `…/954.json` (shuffle confirmed), 12 real traits incl. Tier, image loads through the Pinata gateway;
  - wallet states honest: "No browser wallet detected" without a provider, connect button with a provider, connected state shows network + short address.

## 2026-10-16: stack v6 on Monad testnet (the demo stack)

Deployed once, as agreed — no intermediate deployment, no draw on anything but
the final stack. This is the stack the demo draw ran on and the one
`infra/deployments.json` points at.

### Stack

Read the addresses from `infra/deployments.json`; they are deliberately not
duplicated here. All six confirmed to hold code, and every wiring verified by
calling the getter on the deployed contract rather than trusting the deploy
script's own log:

- `pool.mirror` / `pool.drawEngine` / `pool.yieldAdapter`
- `engine.pool` / `engine.careerStore`
- `adapter.pool` / `adapter.router`
- `pool.asset`, and the owner of mirror, pool and engine

### commitWindow = 600 seconds

Set at deploy time via the `CHOGPOOL_COMMIT_WINDOW` override. The demo draw's
commit window genuinely elapsed between the open and close invocations — the
close phase polls the chain's own clock and refuses to close early rather than
faking the wait. No `vm.warp`, no simulated time.

### Two failed attempts before this one, both worth recording

**Attempt 1 ran from the wrong directory.** `forge script` was invoked from the
repo root, but the Foundry project is `contracts/`. Compile error, nothing
broadcast. The broadcast directory still held only the previous run.

**Attempt 2 used Foundry's default sender.** The deployer key is
`CHOGPOOL_DEPLOYER_PRIVATE_KEY`, but the script reads `PRIVATE_KEY`, and the env
file's name does not match. The script simulated against Foundry's default sender
`0x1804c8AB…` and refused with "You seem to be using Foundry's default sender" —
but it still wrote a plausible-looking `contracts/deployments.json` whose
`deployer` field said `0x1804c8AB…`. **A simulation writes that file; it is not
evidence of a deployment.** The real broadcast only happens once `--private-key`
(or `PRIVATE_KEY`) is set.

**Attempt 3 ran out of gas partway.** Three of twelve transactions landed
(ChogMirror, ChogPool, PuddleLpAdapter) before the fourth CREATE hit
`out of gas: gas required exceeds allowance`. The deployer held 0.088 MON,
roughly 865k gas units against a ~2.6 MON requirement. Those three contracts are
unwired orphans and nothing depends on them. After the wallet was topped up the
deploy was re-run from a clean slate rather than resuming, so no orphaned
address was ever reused.

### Operational note for anyone re-running Gate 1 on this stack

The funding phase is **not** resumable on a pool that already has deposits. It
claims from the faucet and swaps for both racers regardless of whether they
already hold positions, which moves the pair and makes the script's own
`pool booked more principal than the venue holds` guard revert. That guard is
correct and it protected the live pool — a reverted forge script discards its
broadcasts, so nothing landed. But a re-run on v6 will always fail at that step;
run the draw phases directly.
