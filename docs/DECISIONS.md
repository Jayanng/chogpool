# DECISIONS LOG

Standing record of cuts, scope changes and judgement calls, per PLAN.md rule 9
("cuts need both owners to agree and get recorded in docs/DECISIONS.md").

Every entry states what was decided, why, what it cost, and what would reverse it.
Nothing here is a summary of work done — it is the reasoning a future reader (or a
judge) needs in order to evaluate the choice.

---

## 2026-10-18 — Fresh stack deployed with the honest pot path

**Decided:** A fresh stack was deployed and is now the demo surface. The live v4
pool, its deposits and its finalized Draw 1 are left as they are.

**Deployed** (Monad testnet, chainId 10143, blocks 72463194–72463267, 14 txs):

| Contract | Address |
|---|---|
| ChogMirror | `0xc8b49dbd74B0B5EEaE158Cdb671bcec931DC7E31` |
| ChogPool | `0x79D30244bD59c01aD1963800791522e3dAA876e0` |
| PuddleLpAdapter | `0x96EB00390bA95970310EF2721C7948CdFD6aF7Ed` |
| CareerStore | `0x336258EB8099cE594a3d0154C9e8CF9Fa7fa8c67` |
| DrawEngine | `0x68e8eaf6a7F3ccD54d1155Dbc2b43c7EEc377B7e` |
| TestChogToken | `0x94a4456e3051B37ECb1AA46423779F35cc9D063d` |

`commitWindow` = 300 seconds so a full draw runs end to end in one sitting.
Pot seeded with 20 USDC: `potBalance == potSeeded == 20000000`, and the pool
holds exactly 20 USDC against it. Earned yield is 0, and says so.

**Why fresh rather than migrated:** `ChogPool`'s constructor takes `mirror` as
`immutable` and the pool has no upgrade path, so three demo-critical fixes could
not reach the v4 contracts:

1. `withdrawAll` demanded the nominal share count, which reverts whenever the
   venue's value has drifted below entry value — the state that stranded racer2's
   position and would show a blocked withdrawal against a headline promise of
   "principal withdrawable any time".
2. `seedPot()` cannot be added to a deployed pool.
3. `principalDeployed` was a monotonic counter that never decremented, which made
   `harvest()` read a loss and permanently blocked the pot.

All three land in this deploy.

**Note on the earlier "migration is blocked" claim:** that was wrong. The deployer
key for the pool owner was on the host at `~/.chogpool-deploy/deployer.env` and was
not found in the initial search. With it available, `MigrateStack.s.sol` could have
carried the live deposits across. The fresh deploy was chosen anyway because it is
the lower-risk path inside the remaining time and because the live position's
recovery was being handled separately by its depositor.

**What this cost:** the live deposits and the finalized Draw 1 are not carried
over. The demo runs on a fresh venue.

**Reversal:** not reversible — the v4 pool remains live and untouched, so nothing
was destroyed. If the owner key is used, `MigrateStack.s.sol` can carry deposits
from the v4 pool into this one.

---

## 2026-10-18 — Prize pot on the demo stack is seeded, not earned

**Decided:** The demo stack's prize pot is funded by `seedPot()`: real faucet USDC,
transferred by a real transaction, tracked in a separate on-chain counter
(`potSeeded`) from the pot balance (`potBalance`). The earned yield is exactly
`potBalance - potSeeded`, computable from state or events alone.

**Why:** The pot's intended funding is `harvest()`, which books the surplus the
PuddleSwap LP position earns from trading fees. On the Monad testnet USDC/USDT pair
that surplus is structurally zero, and the reason is measurable:

- the pair is seeded ~20:1 imbalanced (~19,638 USDT against ~975 USDC);
- `kLast() == 0` and there are zero swap/mint/burn events, so liquidity has never
  been added or removed by anyone but our adapter;
- `positionValue()` (40.56) sits below `principalDeployed()` (105.01), so
  `harvest()` sees a 64.45 USDC loss and returns 0 — the pool reverts
  `NothingToHarvest`.

Generating a visible pot through real trading would require on the order of 80x
the pair's entire USDC reserves in turnover (a 5 USDC pot needs ~79,200 USDC of
volume, against a faucet that yields 1,000 USDT/day). That is not achievable before
the Oct 23 deadline, and no code change alters the arithmetic.

**What this cost, said plainly:** the pot on the demo stack is not yield. It is
real money, put there by hand, and every surface that shows it says so. The earned
yield on this stack is zero and is displayed as zero.

**The alternative that was rejected, and why:** routing a faucet deposit through
`adapter.harvest()` would also have produced a payable pot. It was rejected because
`positionValue()` counts loose asset in the adapter, so that path books a deposit as
a harvest — the same real money and the same traceability, but the number would be
labelled yield while being a deposit. `seedPot()` exists specifically so the pot can
be funded without that misrepresentation, and the separate counter is the mechanism
that keeps the two apart.

**Rules honoured:** rule 1 (nothing invented — the USDC is real and the tx is
traceable), rule 3 (faucet funds only, zero spend), rule 4 (the *labelling* is
honest: seeded is never presented as earned), rule 7 (every surface shows the split).

**Reversal:** if the testnet pair ever gets balanced and traded, set
`CHOGPOOL_SEED_POT=0` on the next deploy and the pot is funded purely by harvest.

**Requires:** a fresh stack deploy (see the entry below), because the live pool is
immutable and cannot take a new function.

---

## 2026-10-18 — Live stack abandoned in favour of a fresh deploy

**Decided:** The demo moves to a newly deployed stack. The live pool
(`monadTestnet.chogPool` in infra/verified.json), its deposits and its finalized
Draw 1 are left as they are and are no longer the demo surface.

**Why:** three fixes that matter for the demo cannot reach the live contracts,
because `ChogPool`'s constructor takes `mirror` as `immutable` and the pool has no
upgrade path:

1. `withdrawAll` demanded the nominal share count, which reverts whenever the
   venue's value has drifted below entry value — the state that stranded racer2's
   position and would show a blocked withdrawal on screen, against a headline
   promise of "principal withdrawable any time".
2. `seedPot()` cannot be added to an already-deployed pool.
3. The mirror's `testDriveTokenOf` convenience cannot be added either, for the same
   immutability reason.

All three land in the same fresh deploy, which is why they were bundled.

**What this cost:** the live deposits and the finalized draw are not carried over.
The migration script (`contracts/script/MigrateStack.s.sol`) exists and is dry-run
clean, but it is blocked on the pool owner key, which was created in a prior session
and is not on any host in this project. Carrying the deposits over is therefore not
available, and the honest statement is that the demo runs on a fresh venue.

**Reversal:** if the owner key surfaces, `MigrateStack.s.sol` carries the live
deposits into the new stack.

---

## 2026-10-18 — `testDriveTokenOf` descoped

**Decided:** not implemented. Reasoning recorded at the declaration site in
`contracts/src/ChogMirror.sol` next to `hasTestDrive`.

**Why:** it can only land on a redeploy, and the redeploy was itself blocked (see
above). Additionally, a mapping set only at Test Drive mint would not serve verified
holders, who mirror real mainnet Chogs through `mintWithSig` — the general fix is
`tokenOfOwner(address)`, maintained across both mint paths, which is a larger change
on the same immutable mirror.

**Reversal:** fold it into the first unblocked redeploy, implemented as
`tokenOfOwner` rather than the narrow test-drive-only mapping.

---

## 2026-10-18 — GATE3 fixture values corrected

**Decided:** the recorded Draw 1 and Draw 2 values in `web/src/fixtures/index.ts`
were corrected to match the chain, with the previous (wrong) values named in the
comments rather than silently overwritten.

**Why:** the fixture quoted `finalRandomness` and `revealBlock` values that the live
engine does not report, and Draw 2 derived its randomness from that wrong
blockhash. The winners were reproducible either way (independently re-derived:
`keccak(randomness,0) mod 71186086 = 32654897`, inside racer 1462's 52,934,966-ticket
range), so no race result was ever wrong. But a fairness verifier fed the wrong
randomness would have been proving the right answer from the wrong input, which is
the one failure mode a verifier must never have.

**Cost:** none — the fixture values now match the chain, which is what they claimed
to be all along.
