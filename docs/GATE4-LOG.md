# GATE 4 AUDIT LOG, the money + identity layer

**Phase 4 (MONEY + IDENTITY) owner:** teammate. **Audit by:** the same pass that
wrote this log, re-run against the freshly deployed stack.

**Date:** 2026-10-18. **Base:** `e2f54d4` plus the working-tree changes deployed as
the new stack (blocks 72463194–72463267).

---

## What Gate 4 requires (PLAN.md, Phase 4)

> money path fully real on testnet; mirror-mint with a real mainnet signature works
> end-to-end; Aave rehearsal log committed.

Plus the Phase 4 build prompt's specific asks: deposit dashboard with position
card, faucet claim with cooldown shown, withdraw in one click for full principal,
honest labels everywhere, no fixture imports in the prod build.

---

## 1. What was deployed and verified on-chain

| Contract | Address | Verified |
|---|---|---|
| ChogMirror | `0xc8b49dbd74B0B5EEaE158Cdb671bcec931DC7E31` | 16,407 bytes code |
| ChogPool | `0x79D30244bD59c01aD1963800791522e3dAA876e0` | 20,083 bytes code |
| PuddleLpAdapter | `0x96EB00390bA95970310EF2721C7948CdFD6aF7Ed` | 14,787 bytes code |
| CareerStore | `0x336258EB8099cE594a3d0154C9e8CF9Fa7fa8c67` | 7,011 bytes code |
| DrawEngine | `0x68e8eaf6a7F3ccD54d1155Dbc2b43c7EEc377B7e` | 17,785 bytes code |
| TestChogToken | `0x94a4456e3051B37ECb1AA46423779F35cc9D063d` | 6,081 bytes code |

Wiring read back from chain, not assumed from the script:

```
pool.yieldAdapter    = 0x96EB00390bA95970310EF2721C7948CdFD6aF7Ed   (the adapter)
pool.drawEngine      = 0x68e8eaf6a7F3ccD54d1155Dbc2b43c7EEc377B7e   (the engine)
engine.pool          = 0x79D30244bD59c01aD1963800791522e3dAA876e0   (the pool)
engine.careerStore   = 0x336258EB8099cE594a3d0154C9e8CF9Fa7fa8c67   (careers)
engine.commitWindow  = 300
```

---

## 2. The pot, and exactly what it is

```
potBalance : 20000000  (20.000000 USDC)
potSeeded  : 20000000  (20.000000 USDC)
pool USDC  : 20000000  (the pool holds exactly what it says)
earned     : 0         (potBalance - potSeeded)
```

The 20 USDC came from a real transaction: 700 faucet USDC swapped through
PuddleSwap (faucetUSDC → USDT → puddleUSDC), yielding 26.562797 puddle USDC to the
deployer, of which 20 was transferred into the pool by `seedPot()`. Funding tx:
`0xf79904a5dfca4738ae01b0cf462cea7fce833d3d162a0ec8341b570519140218` (block
72461843).

**Why it is seeded and not earned.** The pot's intended funding is `harvest()`,
which books `positionValue() - principalDeployed` on the PuddleSwap LP. The Monad
testnet USDC/USDT pair earns nothing, and the reason is measurable, not a guess:

```
USDT reserve : 19,637.896101
USDC reserve :     975.176301
implied      : 20.1378 USDT per USDC   (a stable pair should be ~1.00)
kLast()      : 0                        (no mint or burn has ever happened)
swap events  : 0 in the recent block range
```

The pair is seeded ~20:1 imbalanced and dormant, so `positionValue()` (40.56) sits
below `principalDeployed()` (105.01) on the old stack and `harvest()` returns 0.
Generating a visible pot through real trading would need on the order of 80x the
pair's entire USDC reserves in turnover — a 5 USDC pot requires ~79,200 USDC of
volume against a faucet that yields 1,000 USDT/day.

**How the honesty is enforced, not just promised.** `potSeeded` is a separate
on-chain counter that only `seedPot()` ever increments, and `seedPot()` emits
`PotSeeded`, never `PotIncreased`. So:

- the earned yield is `potBalance - potSeeded`, computable from state alone;
- it is also computable from events alone, because seeded and harvested money
  arrive under different event names;
- a judge never has to trust a label to tell them which is which.

The UI shows both figures and states that the testnet pair is quiet.

---

## 3. Defects found and fixed in this pass

### 3.1 `withdrawAll` could revert on ordinary venue drift (the stranding bug)

The old `withdrawAll` called `redeem(pos.shares, …)` — the **nominal share count**.
The venue's value moves with trading, so whenever a position had drifted below its
entry value the venue reverted `InsufficientLiquidity`. Verified live: racer2's
887,422 shares against a venue worth 790,444 reverted exactly this way, on a button
labelled "Withdraw all" next to copy reading "What you can withdraw, in full."

That is the worst possible demo failure, because the headline promise is that
principal is withdrawable any time.

**First fix attempt was wrong and the tests caught it.** Reading `positionValue()`
for the whole venue let one depositor's withdrawal drain another's money: alice's
`withdrawAll` paid her bob's USDC, and bob's subsequent `redeem(0)` delivered
nothing. Trading a revert for a silent mispayment is worse, not better.

**Correct fix:** withdraw the position's **pro-rata slice** of the venue, computed
from `totalShares` before any state changes, clamped to the position's own claim.
Shares are then burned against what was actually paid, and any shortfall is emitted
as `EntryCostRealized` rather than dropped.

Pinned by four tests, all green:

```
test_WithdrawAll_NeverRevertsOnVenueDrift        PASS
test_WithdrawAll_PaysOnlyThisPositionsSlice      PASS
test_WithdrawAll_EmitsTheRealizedShortfall       PASS
test_TwoDepositors_BothExitInFull_ThroughCostChargingVenue  PASS
```

Plus `contracts/test/ChogPoolWithdraw.fork.t.sol`, 3/3 against the **live** v4
stack, which reproduces the old revert and then proves the new call succeeds on the
identical state.

### 3.2 The UI promised more than the chain could deliver

`web/src/money/deposit.tsx` showed "YOUR PRINCIPAL / What you can withdraw, in
full" sourced from the pool's credited principal, and the button called
`withdrawAll`. Both were wrong together: the number was the credited figure, the
transaction demanded the nominal share count, and neither was what the venue could
actually pay.

**Fix:** a `withdrawable()` read that computes the position's pro-rata slice of
`positionValue()`, shown as "WITHDRAWABLE NOW" with copy that says plainly it can
sit below the deposit because swap fees and price drift move it.

### 3.3 `principalDeployed` was monotonic and blocked harvest forever

`principalDeployed` only ever increased, so on the old stack it sat above
`positionValue()` and `harvest()` read a permanent loss. `redeem()` now releases
cost basis pro-rata to the LP units removed, symmetric with `supply()`, and
`harvest()` deliberately does not decrement it (it realizes surplus *above* basis;
decrementing would double-book).

### 3.4 Deploy script: the seed ran outside the broadcast block

`_maybeSeedPot()` was called after `vm.stopBroadcast()`, so its `startBroadcast`
had no sender and the script aborted with "default sender". Moved inside the main
broadcast block. Caught by a dry run before any broadcast, which is the only reason
it cost nothing.

---

## 4. Mirror mint and the Aave rehearsal

- **Mirror mint with a real mainnet signature:** `ChogMirror.mintWithSig` verifies
  an EIP-712 `Mirror(tokenId, mainnetOwner, minter, nonce, uriHash)` signature and
  stores the recovered mainnet owner plus the real `tokenURI`. Covered by
  `ChogMirror.t.sol` (26 tests) and `ChogMirrorProto.t.sol` (10 tests).
- **Aave rehearsal:** recorded in the Gate 1 log and `TESTING.md`. Aave V3 is the
  production venue on Monad mainnet; it is **not** deployed on Monad testnet, so
  nothing on this build touches it, and every surface says so. The rehearsal proves
  the `IYieldAdapter` path (supply → interest accrual → harvest above principal →
  pot) against real Aave contracts on a local mainnet fork, at zero spend.

---

## 5. Gate protocol steps

1. **Positive suite:** `forge build` clean; `forge test` 170/170 across 12 suites;
   `vitest` 94/94; `tsc -p tsconfig.json --noEmit` clean; `check-addresses` exit 0;
   `check-fixtures` exit 0.
2. **Negative tests of enforcement tools:** planted `0x1234…` in `web/src/` →
   `check-addresses` exit **1**; removed → **0**. Planted fixture sentinel → exit
   **1**; removed → **0**. Both failure paths exercised.
3. **Tracked-file audit:** `git ls-files` contains zero `out/`, `cache/`, `dist/`,
   `broadcast/` or `*.lock` artifacts. The deploy's `broadcast/` and `cache/`
   directories were removed after the run.
4. **Pattern-correctness:** the `docs/GATE3-LOG.md` / `docs/GATE4-LOG.md`
   allowlist entries were tested both ways — allowlisted file passes, the same
   literal in a non-allowlisted `docs/` file fails.
5. **Drift check vs the registry:** `infra/deployments.json` moved from
   `contracts/` to `infra/`; `node infra/gen-addresses.mjs` regenerates
   `web/src/generated/addresses.gen.ts` byte-identically; the registry parses;
   every deployed address appears in the generated module.
6. **Honest report:** the four defects above are the full list. None were hidden
   and none were fixed silently — each carries a comment at the fix site naming what
   was wrong and why the change was made.
7. **Exit-code discipline:** statuses read from the tool, never after a pipe.
8. **User sign-off:** pending — the deposit dashboard, faucet cooldown and withdraw
   are walked in a browser before this gate is declared closed.

---

## Verdict

**AUDITED, pending user sign-off.** The money path is real end to end on testnet,
the stranding defect is fixed and pinned by both unit and live-fork tests, and the
prize pot's composition is separable on-chain so no judge has to take a label on
trust.
