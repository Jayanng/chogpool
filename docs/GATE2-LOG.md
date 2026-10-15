# GATE 2 AUDIT LOG, design base + app shell

Audited: 2026-10-15 by a fresh agent pass (no prior context on the Phase 2 code), per the
GATE PROTOCOL in docs/PLAN.md. This log is evidence, not source: it quotes the real addresses
and values the checks actually produced.

## Gate 2 criteria, verdicts

| Criterion | Verdict | Evidence |
|---|---|---|
| `/style` renders every component of packages/ui with real tokens | PASS | All 8 components mounted in a live browser (buttons 6, badges 7, cards 2, stats 3, marquee 1, toasts 3, skeletons 4, panels 12); token tables render color/radius/space/type/motion incl. spring curves |
| Landing + wallet + any-Chog viewer working against Monad mainnet | PASS | `readChog(1)` and `readChog(1462)` executed through the real `web/src/lib/chog.ts` code path in-browser against https://rpc.monad.xyz + Pinata gateway; wallet state machine exercised (mock EIP-1193 provider, see caveat below) |
| Fixture mode (`VITE_FIXTURES=1`) runs the deposit flow visually | PASS | `/deposit` in the fixture dev server: deposit 10.00 → "Simulated deposit of 10 USDC bound to Chog #1462. No real funds moved (dev fixture)." plus both error paths (bad id, zero amount) and the position card updating |

## Mainnet Chog read layer, real responses (2026-10-15)

- `ownerOf(1)` = `0x3D38FeE3E1a4c43d8fcF715aA6C9ff025074E7E0`, `tokenURI(1)` =
  `ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/1462.json`
  (shuffled mapping confirmed: token 1 → 1462.json), Tier = **Uncommon**, 12 real traits
  (Background=Deep Aqua, …, Naked=No). Image resolved and rendered via the Pinata gateway
  (naturalWidth 1000).
- `ownerOf(1462)` = `0x8CcFAA2C191F60a5a625064aE9682Bb82b1c6d94`, `tokenURI(1462)` = `…/954.json`
  (token 1462 → 954.json), Tier = **Common**.
- ChogViewer UI: lookup 1462 renders owner + tokenURI + Tier + all trait badges + real image;
  the "our design, derived from real traits" label is present. Invalid input (9999) shows
  "Enter a Chog ID from 1 to 1,969."

## Defects found by this audit, fixed before close

1. **Production countdown was dead copy.** With fixtures off, the landing said "Schedule
   announced when the pool contract goes live (Phase 1)", stale since Gate 1 deployed the
   pool (`0x50E326283BbF7eeC51dB4f1552945a75457e331b`). Fixed: new `web/src/lib/live.ts`, a
   read-only GameSource reading `nextDrawAt()` / `potBalance()` / `depositOf()` from the
   deployed pool (contract semantics: `nextDrawAt() == 0` → "not scheduled", never a made-up
   schedule). The landing countdown and prize pot are now live in production builds.
2. **Deposit page would have offered a write form against the live source.** The form was
   gated on "any game source"; with a live source that would fake a working write path.
   Fixed: the form renders only in fixture mode; the live state is read-only (live pot +
   next-draw stats) with the honest Phase 4 money-path boundary in copy.
3. **Stale copy**: "AWAITING PHASE 1 CONTRACTS" badge and "goes live with the pool contract
   (Phase 1)" → replaced with the actual boundary (pool live on testnet; wallet money path
   lands Phase 4). Countdown null-state copy now matches the contract's own semantics.

No defects found in: `/style` completeness, fixture isolation, Chog read layer, wallet state
machine, share-card stub, check-addresses/check-fixtures enforcement.

## Wallet layer evidence (caveat: mock provider)

Browser wallet states exercised with a mock EIP-1193 provider injected before page scripts
(no MetaMask extension exists on this machine): detection labels → connect →
"Monad Mainnet | 0x2222…2222 | Switch to Play network" on chain 143 → switch → honest
chain re-read → "Monad Testnet" → `accountsChanged` resets to "Connect wallet".
**Real-extension testing (MetaMask/Rabby install + approvals) remains a human step.**

## Gate protocol steps

1. **Positive suite**, `forge build` + `forge test`: 133 passed / 0 failed (9 suites);
   `pnpm --filter @chogpool/ui build` green; `pnpm build:web` green (tsc strict + vite);
   `node infra/check-addresses.mjs` OK; `node infra/check-fixtures.mjs` OK. CI on GitHub
   runs after the user pushes (repo is private; pushes are the user's call).
2. **Negative tests** (exit codes read from the tool, no pipes):
   - planted `0x1234567890123456789012345678901234567890` in `web/src/` → check-addresses
     **exit 1**; removed → **exit 0**.
   - planted `CHOGPOOL_FIXTURE_BUNDLE_SENTINEL` in `web/dist/index.html` → check-fixtures
     **exit 1** (FIXTURE LEAK); restored → **exit 0**.
   - fixture file without sentinel (R1) → **exit 1**; direct fixture import outside
     `web/src/lib/game.ts` (R2) → **exit 1**; clean → **exit 0**.
3. **Tracked-file audit**, `git ls-files` contains zero dist/out/cache/.lock artifacts
   (83 tracked files); `git status` clean after the audit commands.
4. **Pattern-correctness**, the new allowlist entry for this log was tested both ways:
   a full address inside `docs/GATE2-LOG.md` is accepted; the same literal in another
   `docs/` file still fails check-addresses (exit 1).
5. **Drift check**, `node infra/gen-addresses.mjs` regenerates
   `web/src/generated/addresses.gen.ts` byte-identically (`git diff --exit-code` = 0);
   registry parses; every deployments.json contract address appears in the generated
   module (`pair` = `TESTNET.pairUSDCUSDT`; `deployer` is deploy metadata by design, not
   an app address).
6. **Honest report**, the defect list above is the full list of what this pass changed.
7. **Exit-code discipline**, every command in this audit was run without output pipes
   masking status; statuses echoed verbatim.
8. **User sign-off**, pending: the design lead verifies `/style`, landing and the fixture
   deposit flow in a browser before Phase 2 is declared closed.
