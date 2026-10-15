# Deploy Log

## 2026-10-14: Phase 2 (design system + app shell) · production

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
