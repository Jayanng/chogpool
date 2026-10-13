# CHOG POOL — THE CHOG TRACK
## Master Build Plan (Chogathon 2026, 1st-place target)

**Team:** Jayanng (frontend design base, race experience, video) + teammate (money path, identity layer, verify pages)
**Deadline:** submissions close **Oct 23, 2026, 15:00 UTC** (verified from chogathon.chog.xyz, "Open until Oct 23, 15:00 UTC")
**Repo:** private until submission, then public for judges
**Rule of the build:** nothing mocked, nothing hardcoded. Real contracts, test value. Every address in a registry, every claim verified.

---

## VERIFIED FACTS BASE (everything below re-checked live on 2026-10-14)

### Monad mainnet (chainId 143, RPC https://rpc.monad.xyz)
| Fact | Value | How verified |
|---|---|---|
| Chog Genesis NFT | `0xc96d31F8626C6D03Fae5dCD3d61e3FB9F4a73763` | eth_call: name="Chog Genesis", symbol="CHOG" |
| Chog Genesis supply | **1,969** | totalSupply() |
| Metadata | `ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/{shuffled-id}.json` — token 1 → `1462.json`, token 1462 → `954.json` (mapping SHUFFLED, not identity) | tokenURI(1), tokenURI(1462) |
| Real traits (token 1) | Background, Aura, Base, Skin, Side, Body, Mouth, Eyes, Head, Form, **Tier (e.g. "Common")**, Naked | fetched JSON via Pinata IPFS gateway |
| Traits storage | **Off-chain IPFS** (not on-chain stats). Our boost mapping is our design layer on real metadata | tokenURI is ipfs:// |
| $CHOG ERC-20 | `0x350035555E10d9AfAF1566AaebfCeD5BA6C27777`, name "Chog", 18 decimals | eth_call |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | eth_call symbol=USDC |
| Aave V3.7 Pool | `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef` (code at address) | eth_getCode |
| Aave USDC aToken | `0x35a73BAcb179d3740395A3ceCc87FF2e581d6042` (symbol aMonUSDC) | eth_call |
| Aave on Monad | live since 2026-07-02, 12 assets, $15M first-year Monad Foundation incentives | monad.xyz blog + multiple news |
| USDC native on Monad | via Circle CCTP | Circle docs (via search) |

### Monad testnet (chainId 10143, RPC https://testnet-rpc.monad.xyz)
| Fact | Value | How verified |
|---|---|---|
| PuddleSwap core USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 dec) | eth_call |
| PuddleSwap USDT | `0x1314b22df27BDcD4F8D11a0f4185943e55748917` (6 dec) | eth_call |
| PuddleSwap WMON | `0x97B3070F9Da6C002343862b35E68Bd8e22608943` (18 dec) | eth_call |
| UniswapV2 Factory | `0xd498f5beBD0C9f1FE0135a0Cf942dA67Ee6e8A9B` | getPair resolved pairs |
| UniswapV2 Router02 | `0x430c23895c8D44883526e3E0B09327dAD8766660` | skill.md + app live |
| StableFaucet | `0x50959dd2a4ef310f9aa2df9498cE9aC0aB956276`, `claim()` mints 1,000 USDT, 24h cooldown, 2791 bytes code at address | eth_getCode |
| USDC/USDT pair | `0xea236abc4fa54bf5a7a690d0cc2190f3b2c138f9` — reserves 6,001 / 2,292 (6 dec), last swap ~30h ago | getReserves + blockTimestampLast |
| USDC/WMON pair | `0x1fbc7b6b54726d735ff1b47df75535b4b9021902` — 892 USDC / 229 WMON, last swap ~2.4h ago | same |
| USDT/WMON pair | `0x0002b40b245efcd99a41fd0fb11f2ed90123933d` — 10,524 USDT / 956 WMON, last swap ~5.2h ago | same |
| Faucet (gas MON) | https://faucet.monad.xyz (429 under bot load = alive but rate-limited; teammate/you claim from browser) | curl |
| Explorers | Monadscan (Etherscan-like) 403 to bots but real; MonadVision; JiffyScan | docs.monad.xyz llms.txt |
| Testnet reset note | testnet reset from genesis 2025-12-16; canonical contracts redeployed | docs.monad.xyz/testnets |
| Nad.fun | Monad launchpad, bonding curves, **mainnet** (not testnet yield) | nad.fun/llms.txt + news |

### Chogathon rules (from chogathon.chog.xyz, saved copy)
- Judging: Novelty 30% ("new way to use or interact with NFTs"), Fun 20%, Retention 20%, Clarity 15%, Execution 15%, $CHOG bonus (optional, bonus points)
- Gate: "The Chog NFT must be essential"
- Prizes: 50 winners share $15K pool (organizers may cut to $10K); 1st $4,500 / 2nd $2,500 / 26th-50th $50 (unverified — do not cite; cite only "50 winners share $15K, first place $4,500" if needed)
- Deliverables: banner, description up to 8,000 chars, app link, demo video ≤3 min (YouTube unlisted or Google Drive), testing instructions, repo + tech stack + pre-existing work disclosed, go-to-market optional, user feedback section
- One project per team; submissions close Oct 23 15:00 UTC; prize pool $15K planned (may be cut to $10K)
- Team name pending
- Register/check Discord for any schedule updates

### Tooling (checked 2026-10-14 against live npm registry)
- viem 2.57.5, @openzeppelin/contracts 5.6.1, typescript 7.0.2, vite 8.3.4 (use ^ ranges within same major)
- Foundry (forge/cast/anvil) — install during Phase 1 per plan
- MetaMask/Rabby + hardware-wallet-free test wallets

## BANNED / UNVERIFIED — never put in judge-facing copy
- "~990 Chog holders", "34k $CHOG holders" (unverified)
- Any prize split beyond "50 winners share $15K" and 1st=$4,500 (per-site text we captured; the rest is from an early summary, treat split details below 1st as unverified, keep out of copy)
- Any "guaranteed no loss" absolute (Aave smart-contract risk exists)
- "Chainlink VRF on Monad" (docs show no VRF support on Monad)
- 5.8% APY as a fixed number (variable, incentive-driven; read live, label "current, variable")
- "On-chain traits" (traits are off-chain IPFS)

---

# PHASE 0 — FOUNDATION (Days 0-1): repo, toolchain, verified-address registry

**Owner: Jayanng** (teammate mirrors env)

1. Create private repo `Jayanng/chogpool` (GitHub, gh CLI authenticated as Jayanng, ssh protocol). `.gitignore` for node_modules, out/, cache, .env, deployments private keys.
2. Directory layout (monorepo):
```
chogpool/
  contracts/
    interfaces/          # frozen contracts between us (I*.sol)
    src/                 # real implementations
    test/                # forge tests
    script/              # deploy scripts
    fixtures/            # dev-only MockERC20/MockERC721 for tests — NEVER imported by src/
  packages/ui/           # design system (yours) — versioned, style-guide page
  web/                   # vite + react + viem app
    race/  draft/  money/  identity/  verify/  spectator/
  infra/
    deployments.json     # chainId -> addresses (single source of truth)
    verified.json        # every researched address + source + date
    check-addresses.mjs  # fails CI if any 0x literal outside registry
  docs/
    PLAN.md (this file), RULES.md, WORKING-AGREEMENT.md
  .github/workflows/ci.yml
```
3. Toolchain: Foundry (forge + cast + anvil) via foundryup; Node 22 (VPS has v22.23.2); pnpm workspace. `pnpm` workspace files at root.
4. `infra/verified.json` seeded with every address from the FACTS BASE above (mainnet + testnet), each with `source` and `verifiedDate: "2026-10-14"`.
5. CI (GitHub Actions): forge build + forge test + `node infra/check-addresses.mjs` + `pnpm -r build` + eslint. **CI runs in the cloud, never on our 2-CPU VPS.**
6. RULES.md = the 10 rules we agreed (nothing mocked/hardcoded, zero money, real yield only, real randomness, verified facts only, honest framing, Test $CHOG allowed, full scope, mirror-NFT design, team split).
7. Working agreement: trunk-based (short `feat/*` branches ≤2 days), interfaces/ folder is law (changes need both approvals), packages/ui versioned, one deploy owner (teammate) + deployments.json, daily 10-min async check-in, Jayanng tiebreaker.

**Gate 0 (both):** repo skeleton green in CI, verified.json complete, both envs can `forge test` a hello test.

**Phase 0 build prompt (for your coding agent):**
> Set up a Foundry + pnpm monorepo exactly as docs/PLAN.md Phase 0 describes. Initialize infra/verified.json from the FACTS BASE table. CI on GitHub Actions running forge build/test, the address-registry check (fail if any `0x[a-fA-F0-9]{40}` literal appears in contracts/src, web/src, packages/ui/src outside infra/verified.json), pnpm build. Keep node_modules out. Do not invent any address — read infra/ verified.json only.

---

# PHASE 1 — CONTRACTS CORE (Days 1-3): pool, TWAB odds, adapters, draw

**Owner: teammate** (Jayanng reviews PRs)

Deploy targets: **Monad testnet** (chainId 10143). All addresses via infra/verified.json.

1. **`IChogMirror.sol`** (interfaces/): `mintWithSig(tokenId, v, r, s)` verifying an EIP-191 personal_sign message from the REAL mainnet owner; `ownerOf` mirror; `tokenURI` returns the REAL mainnet `ipfs://bafybeid.../{shuffledId}.json` by calling mainnet `tokenURI(tokenId)` off-chain at mint time and storing it (the mirror stores the real URI, never invented traits). Also `mintForTesting(tokenId)` (dev only, guarded `onlyDev`, useful for the 1,969 real IDs during dev and the demo).
2. **`ChogMirror.sol`**: ERC-721 (OpenZeppelin 5.6.1). Mirror metadata: `tokenURI` = REAL mainnet URI (fetched via viem in the mint flow and passed in, or reconstructed from the shuffle mapping if a deterministic source is found; otherwise stored at mint). Emits `MirrorMinted(mainnetOwner, tokenId, realURI)`.
3. **`IChogPool.sol`** (interfaces/): `deposit(uint usdc)`, `withdraw(uint shares)`, `withdrawAll()`, `twabOf(tokenId)`, `potBalance()`, `depositOf(tokenId)`, `nextDrawAt()`. Events: Deposited, Withdrawn, YieldHarvested, PotIncreased.
4. **`ChogPool.sol`** (src/): accepts **PuddleSwap core USDC** (testnet) or mainnet USDC via registry; per-Depositor accounting keyed by the Chog tokenId they bind at deposit (one wallet → multiple Chogs allowed, each with its own book); **TWAB accounting** (ring buffer, standard time-weighted-average math: cumulative balance = lastCumulative + lastBalance × Δt; average = Δcumulative / Δt); **instant full principal withdrawal** (no lock, no fee); snipe-proof odds: win probability ∝ time-weighted average balance (not last-second snapshot).
5. **`IYieldAdapter` interface + `PuddleLpAdapter.sol`**: deposit USDC → swap half to USDT → `Router.addLiquidity` to the **USDC/USDT pair** `0xea23...38f9` → hold LP tokens. **Yield mechanics (correct V2 semantics):** LP fees are not a claimable balance; they accrue inside the pair as k-growth, raising LP redemption value above the deposit value. `harvest()` therefore redeems a small LP slice, measures the real value surplus versus the pro-rata deposit, swaps the surplus to USDC, and moves it into the pot. `redeem()` removes remaining liquidity and returns principal + accrued fees. **The pot only ever grows from value realized through actual removeLiquidity/swap transactions — never from a paper calculation.**
6. **`AaveAdapter.sol`**: same interface; `supply`/`withdraw` on the verified Aave V3.7 Pool; aToken balance is principal + interest; harvest = redeem interest above principal, move to pot. **Mainnet-ready, testnet-forbidden** (Aave not on testnet) — deployed only in a local anvil mainnet-fork rehearsal and in the writeup as the production path.
7. **`DrawEngine.sol`**: commit-reveal draw. `commit(bytes32 h) → reveal(seed) require(keccak(seed) == h)`, reveal deadline after close; final randomness = keccak256(commitSeed, blockhash(revealBlock), previousDrawNumber). Winner check per racer: `keccak256(drawId, tokenId, tier, packedParams, finalRandomness) % totalTickets < winningZone(tokenId, tier)` where `winningZone = tierOdds × twab × traitBoost` (boost capped +25%, scale 1e18 fixed-point). Winner set written on-chain; anyone re-verifies off-chain with published seed. Draw lifecycle: Open → Closed → Awarded → Finalized (mirrors proven lifecycle design).
8. **`TestChogToken.sol`**: ERC-20 "Test CHOG", 18 decimals, faucet claim (1000/day per address, cooldown), explicitly labeled Test in name/symbol.
9. **Tests (forge, invariants):** pool invariants (sum of shares ≤ total; withdraw full principal always possible; TWAB math vs naive integration on random sequences), draw invariants (commit-reveal binding, modulo-bias guarded, winner re-derivation matches on-chain), adapter tests against **stock UniswapV2 fork tests** (anvil local fork of testnet? anvil forks mainnet only — so: fork anvil from testnet RPC URL, which works since anvil fork accepts any RPC; verify adapter against real pair in fork), plus fuzz 1,000 draws for distribution sanity.
10. **CareerStore.sol:** `recordRace(tokenId, raceId, placement, fatigueDelta)`; trophies `1=gold, 2=silver, 3=bronze` counters; fatigue accumulates on wins (decays 1/day); `getCareer(tokenId)` returns portable record; readable by frontend.

**Gate 1 (both):** forge test green including fork tests; a scripted end-to-end on testnet: mint mirror → deposit 10 USDC (claimed from StableFaucet) → add liquidity → simulate swap volume → harvest real fees into pot → draw once with real commit-reveal → winner takes pot → withdraw all. Recorded demo log appended to repo.

**Phase 1 build prompt (teammate's agent):**
> Build contracts/ per PLAN.md Phase 1 using OpenZeppelin 5.6.1 and Foundry. All external addresses must come from infra/verified.json. PuddleLpAdapter must earn pot income only from actual removeLiquidity/swap value differences — no paper fee accounting. DrawEngine: commit-reveal with blockhash binding, winner re-derivable from published seed. TWAB ring buffer like the odds math in PLAN.md. Tests: pool invariants, TWAB vs closed-form, draw binding + bias fuzz, adapter fork test against the real USDC/USDT pair on an anvil fork of https://testnet-rpc.monad.xyz. Do not import anything from contracts/fixtures in src. Write no 0x literals.

---

# PHASE 2 — DESIGN BASE + APP SHELL (Days 2-4, parallel with Phase 1)

**Owner: Jayanng** (design taste leads)

1. **packages/ui** design system: tokens (color, type, spacing, motion tokens + spring curves), core components (Button, Card, Panel, Stat, Badge, Marquee, Toast, Skeleton), dark graphite + signal orange aesthetic per user's palette preferences (indigo/violet+lime accents were 2026-09 TraceZeta-era taste; Chog Track identity: graphite + track-orange + lane-lime), Plus Jakarta Sans (or system fallback stack; VPS can't ship SF Pro — web-safe). Version v0.1.0, style-guide route `/style` renders every component.
2. **web app shell**: Vite 8 + React 19 + TypeScript (strict) + viem 2.57.5 + wagmi or viem-only wallet handling. Pages: `/` (landing + countdown), `/deposit`, `/race`, `/draft`, `/verify`, `/spectator`, `/style`. Routing with a single async page-bundle per route.
3. **Wallet layer**: viem wallet connector UI for MetaMask/Rabby; **dual-network**: read Chogs + $CHOG from mainnet (chainId 143) while the game (deposit/draw) writes to testnet (10143); clean network switcher with explicit labels ("Read: Monad Mainnet · Play: Monad Testnet").
4. **Mainnet read layer**: fetch any Chog by tokenId: owner, tokenURI → resolve IPFS via Pinata gateway → image + traits JSON; cache (SWR) keyed by tokenId; show real Tier trait. **No invented stats on mainnet data — the boost mapping is explicitly labeled "our design, derived from real traits".**
5. **Countdown to next race** (live from `nextDrawAt`), share-card generator stub.
6. Fixtures for not-yet-built contracts: **dev-only** mock implementations of frozen interfaces in `web/src/fixtures/` (clearly named, env-gated `VITE_FIXTURES=1`), never imported in production builds (build-time check in CI).

**Gate 2 (both):** `/style` page complete; landing + wallet + any-Chog viewer working against mainnet; fixture mode runs the deposit flow visually.

**Phase 2 build prompt (your agent):**
> Build packages/ui + web shell per PLAN.md Phase 2. Design tokens first, then components, then pages. Vite env-gated fixtures only via VITE_FIXTURES. All addresses from infra/verified.json → generated TS module. Dual-network viem clients (mainnet reads 143 / testnet writes 10143). No 0x literals, no invented traits. Style guide page at /style renders all components with real tokens.

---

# Phase 3 — THE RACE (Days 4-6)

**Owner: Jayanng** (frontend lead)

1. **Race engine**: deterministic replay — DrawEngine final randomness + Chog traits → per-lane progress curves. The animation is a *visualization of the real on-chain result*, not a source of it. One seed, one result, one animation, every time.
2. **The show**: countdown → gates open → lanes with real Chog images → progress with real trait-driven pace (boost capped) → photo-finish slow-mo → podium, pot transfer, trophy inscription (CareerStore event), confetti + sound (mute default).
3. **Draft Night**: pre-race pick 1-of-3 trait-derived perks ( perk effects are cosmetic pace modifiers within the capped boost; they never change the on-chain winner — on-chain winner is fixed by draw; perks change lane animation flavor + a small Test $CHOG side-prize for "best-dressed" voted by spectators). **On-chain truth vs show layer separation documented in RULES.**
4. **Spectator mode**: view any race without wallet; cheer with Test $CHOG tips feeding bonus pot; non-holders get the "get a Chog" CTA.
5. **Fairness verifier page** `/verify`: paste raceId → contract reads → recompute winner from published seed, show step-by-step derivation, green check when it matches on-chain record.
6. **Share cards**: post-race PNG (canvas) with winner, pot, your Chog, QR to /race.

**Gate 3 (both):** full happy path on testnet with fixture-free real contracts: deposit → race → draw → winner → withdraw; verify page recomputes correctly; race animation deterministic (same seed → same frames).

**Phase 3 build prompt (your agent):**
> Build web/race + web/verify per PLAN.md Phase 3. The animation must be a deterministic function of (seed, traits) so the same seed always renders the same race. Perks affect presentation + side prizes only; the on-chain draw result is the single source of truth for the winner. Verifier page recomputes the exact on-chain formula and must match. No new design tokens outside packages/ui.

---

# Phase 4 — MONEY + IDENTITY LAYER (Days 6-8, parallel-friendly)

**Owner: teammate**

1. ChogMirror signature-mint flow (viem `verifyMessage` against mainnet owner; mirror mint tx on testnet; real URI stored).
2. Deposit dashboard (in your design system): claim stables → approve → deposit → position card (deposit, TWAB tickets, current odds %, countdown) → withdraw (instant).
3. StableFaucet claim integration (1,000 USDT/day, 24h cooldown — show cooldown state).
4. Test $CHOG faucet + cheering flow (tip underdogs; tips → bonus pot contract call).
5. AaveAdapter local anvil **fork-of-mainnet rehearsal** recorded (log in repo): supply → interest accrual (force time advance) → harvest above-principal → pot. Proves the production path with real Aave contracts, zero spend.
6. Docs: TESTING.md — exact judge instructions (claim stables, connect, deposit, race, verify), labels everywhere ("Test $CHOG", "play money on testnet", "production: Aave on Monad mainnet").

**Gate 4 (both):** money path fully real on testnet; mirror-mint with a real mainnet signature works end-to-end; Aave rehearsal log committed.

**Phase 4 build prompt (teammate's agent):**
> Build web/money + web/identity per PLAN.md Phase 4. Mirror mint verifies EIP-191 signature of keccak("CHOGPOOL-MIRROR:" + tokenId) by the mainnet owner; store the real mainnet tokenURI. All labels honest per RULES.md. Faucet UI shows cooldown. Withdraw is one click, full principal. No fixture imports in prod build.

---

# Phase 5 — THE CAREER + $CHOG GAME LAYERS (Days 8-10)

**Owner: Jayanng (design) + teammate (contracts)**

1. CareerStore UI: per-Chog profile page (trophies, fatigue, race history) — the "portable career record" pitch.
2. Champion's Burden: wins add fatigue (win probability multiplier decays daily); UI shows "burdened" state + underdog comeback arcs.
6. Crews: bind 2-5 Chogs → crew races, crew standings.
3. Season ladder: 4 divisions, promotion/relegation at season end (2-week seasons).
4. Draft Night $CHOG economics: reroll costs Test $CHOG (faucet-capped); side prizes.
5. $CHOG hybrid read: frontend shows the user's **real mainnet $CHOG balance** (read-only) next to Test $CHOG balance, labeled.

**Gate 5 (both):** career page, crews, ladder working with real contracts on testnet.

**Phase 5 build prompt (combined agents, split files):**
> Career/crews/seasons per PLAN.md Phase 5. Fatigue multipliers affect odds within the capped window and decay linearly; all contract state changes emit events the UI subscribes to. No speculative features beyond PLAN.md.

---

# Phase 6 — HARDENING + FAIRNESS STRESS (Days 10-12)

**Owner: both, split audit**

1. Fuzz 10k draws: distribution sanity, no modulo bias, commit-reveal binding.
2. Invariant tests: withdraw-all under adversarial sequences (deposit → race → withdraw mid-draw; harvest during withdraw).
3. Gas optimization pass ( Monad gas is cheap; prioritize clarity).
4. Lighthouse-style local audit: our own scan (we have the tooling) + manual: contrast, tap targets, responsive 1440/1280/834/390/360.
5. 834px + phone breakpoints, reduced-motion respected everywhere.
6. Cross-browser smoke (Chrome, one WebKit) + wallet-switcher edge cases.
7. Write SECURITY.md (risks honestly: Aave risk, contract risk, no absolutes).

**Gate 6 (both):** zero failing invariants, fuzz green, audit list closed or explicitly triaged.

---

# Phase 7 — DEMO VIDEO + SUBMISSION (Days 12-14 → Oct 23)

**Owner: Jayanng** (video craft is the win condition)

1. **Script (≤3:00, YouTube Unlisted, 1080p, storyboarded beats):**
   - 0:00-0:15 — Hook: "1,969 Chogs. One track. Your dollars never leave your control." Track shot, gates open.
   - 0:15-0:45 — Connect wallet, real mainnet Chog appears with real traits, mirror-mint to the track.
   - 0:45-1:30 — Deposit flow (claim stables → approve → deposit), position card with live odds, TWAB explanation line: "your odds are time-weighted — no last-second sniping."
   - 1:30-2:15 — THE RACE (photo finish, pot, trophy on-chain, fatigue appears).
   - 2:15-2:40 — The gate beat: "Take the NFT out..." Chog leaves, deposit locks. Then /verify recomputes the winner from the seed. Withdraw full principal on camera.
   - 2:40-3:00 — Close: fun layers montage (draft, cheering, career), "the first no-loss racetrack, on Monad." 
2. Record on the VPS (Screen-Studio-class pipeline we've used; real footage only, no AI footage).
3. Submission fields (8,000-char description): problem, mechanic, NFT-essential argument, fairness (commit-reveal + verifier), Test $CHOG bonus use, honest testnet/mainnet labeling, testing instructions, repo + stack, pre-existing work disclosed (design system, tooling), what's next.
4. Repo public for judges; judge-access README quick-start ≤ 5 steps.
5. Dry-run the judge path 2x from a clean wallet.

**Gate 7 (both + user manual verification per standing rule):** user watches the video + live app, approves before submit.

---

## SCHEDULE SUMMARY (Oct 14 → Oct 23, 15:00 UTC)
- Oct 14-15: Phase 0 + start Phase 1
- Oct 15-17: Phases 1-2 parallel
- Oct 17-19: Phase 3 (race)
- Oct 19-21: Phase 4 + 5
- Oct 21-22: Phase 6 hardening
- Oct 22-23: Phase 7 video + submission (buffer before 15:00 UTC Oct 23)
- Every gate: both review; user sign-off before submit (standing rule).

## WORKING AGREEMENT (summary)
- Trunk-based, short feature branches, PRs reviewed by the other person's agent + human glance
- interfaces/ = law; changes need both approvals; packages/ui versioned
- teammate owns contracts/ + web/money + web/identity; Jayanng owns packages/ui + web/race + web/design + video
- CI in cloud (Actions); VPS only for video capture
- deployments.json single source of addresses; check-addresses.mjs in CI
- Daily async check-in; Jayanng tiebreaker

## WHAT WE DO NOT BUILD (scope guards)
- No Telegram/mini-app
- No real mainnet transactions (writes) before submission
- No user auth beyond wallet
- No backend server beyond static hosting + chain reads (host: Vercel free, or IPFS-style static)
- No token launch, no governance, no bridges
