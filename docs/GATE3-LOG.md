# GATE 3 AUDIT LOG, the race layer

**Phase 3 (THE RACE) owner:** Jayanng. **Audit re-run by:** a non-author pass, per
the gate protocol requirement that phase gates be re-run by someone other than the
author of that phase's code.

**Date:** 2026-10-18. **Base:** `e2f54d4` (merge of origin/main), working tree.

---

## What Gate 3 requires (PLAN.md, Phase 3)

> full happy path on testnet with fixture-free real contracts: deposit → race →
> draw → winner → withdraw; verify page recomputes correctly; race animation
> deterministic (same seed → same frames).

This audit covers the two parts testable without a browser: the **verifier
recomputes correctly**, and the **animation is deterministic**. The deposit → race
→ draw → winner → withdraw happy path is exercised on-chain by the fork suites and
by Gate 1; the browser walkthrough is the user sign-off step (protocol step 8).

---

## 1. Verifier recomputes correctly — checked against the live chain

The verifier's formula is `keccak256(randomness, i) mod totalTickets`, walking the
frozen cumulative ticket book, with a deterministic forward walk on duplicates.
That is `DrawEngine._deriveWinners`, re-derived independently here rather than
trusted from the source.

Live Draw 1, read from the deployed engine with `cast call`:

```
state             : 4 (Finalized)
seed              : 0x147a012d4a7e433805ac5d04b5c1f19335d3c4dae4f2cf388b11c9b970acf703
commitHash        : 0x81fec32ffe3e8af0f2181dbc5d29761eba8849b05da20b34dd996d489e5c06a7
finalRandomness   : 0xb736d3d207cb065ebc1d62aedae1d0dea2a9ff332e3172fb3f3fcf7b44659ad5
revealBlock       : 71518535
deriveWinners(1,1): [1462]
```

Independent re-derivation:

```
keccak256(finalRandomness, 0) = 0x5649ca2a751f8b89796026c2a4c6abd3dd6eaf3beff72c0f6729efa9801e6e2d
idx = 32654897 mod 71186086
racer 1462 occupies tickets [0, 52934966)  ->  32654897 is inside  ->  winner 1462
```

**Result: the on-chain winner is reproducible from the published seed and the
frozen book, by hand, with no reference to the contract's own answer.** Seed and
commit hash match the fixture exactly; the winner matches.

---

## 2. Defects found by this audit, fixed before close

### 2.1 The fixture quoted the wrong `finalRandomness` for Draw 1

`web/src/fixtures/index.ts` recorded
`0xafb6d2d3faab8959a6dc32ef1d4eaa589d90bc8c6a736ddf967dcc3990c26c09`. The live
engine reports `0xb736d3d207cb065ebc1d62aedae1d0dea2a9ff332e3172fb3f3fcf7b44659ad5`.
Different values.

**Impact:** the recorded winner was still correct — both values land inside racer
1462's ticket range (32654897 and 32905209 respectively, both below 52934966) — so
no race result was ever wrong. But a verifier fed the wrong randomness would have
been **proving the right answer from the wrong input**, the one failure mode a
fairness verifier must never have. A judge walking the derivation would have
recomputed a different hash than the one shown.

**Fix:** replaced with the chain's value, with the previous (wrong) value named in
the comment so the correction is visible rather than silent.

### 2.2 The fixture quoted the wrong `revealBlock` for Draw 1

Recorded `71255613`; the live engine reports `71518535`.

**Impact:** same class. A verifier showing a block number that does not match the
draw is claiming an audit trail it does not have.

**Fix:** corrected, with the same in-place note.

### 2.3 Draw 2 derived its randomness from that wrong block

Draw 2 is a rehearsal draw derived as `keccak256(seed, blockhash(B), uint256(2))`.
It used the wrong `B`. Re-derived from the correct block:

```
wrong block 71255613 -> 0xd897cac8c786f3d036097ed7a86644a3bb0d18d0ae659dab0f95af2bf5f97158  -> winners [1462, 954]
right block 71518535 -> 0x51b5387687df7f79c37fc5feb25e82475c0abc1f0ef4d98c08699b0e006fea18  -> winners [1462, 954]
```

**Impact:** winners unchanged, so the recorded result was never wrong. But the
quoted derivation input was, and the duplicate-walk path it exercises (slot 1
landing on a duplicate and walking forward) would have been demonstrated from a
blockhash that does not exist in the draw it claims to explain.

**Fix:** re-derived from the correct block; winners confirmed unchanged.

### 2.4 Re-verification after the fixes

```
forge test (contracts/)        : 170 passed, 0 failed
vitest run (web/)              : 94 passed, 0 failed
tsc -p tsconfig.json --noEmit  : clean
node infra/check-addresses.mjs : exit 0
node infra/check-fixtures.mjs  : exit 0
```

---

## 3. Determinism of the animation

The animation is a pure function of `(seed, traits)`. Pinned by
`web/src/lib/race-engine.test.ts`:

- `buildRaceReplay(input(seed))` returns the same winner and finish order for the
  same seed across calls;
- lane progress is sampled at 200 points and asserted identical across replays;
- a lane's progress at its own finish time is asserted to be the terminal value.

23 tests across `race-engine.test.ts`, `derive.test.ts` and `draw.test.ts` pass.
The separation rule — the animation visualizes the on-chain result and is never a
source of it — is documented in `docs/RULES.md` rule 5.

---

## 4. Gate protocol steps

1. **Positive suite:** `forge build` + `forge test` 170/170; `vitest` 94/94; `tsc`
   strict clean; both infra checks exit 0. CI runs on the merge commit after push.
2. **Negative tests of enforcement tools:** a planted `0x1234…` literal in
   `web/src/` makes `check-addresses` exit **1**; removed, it exits **0**. A
   planted fixture sentinel in a built bundle makes `check-fixtures` exit **1**;
   removed, **0**. Both failure paths exercised, not assumed.
3. **Tracked-file audit:** `git ls-files` contains zero `out/`, `cache/`,
   `dist/`, `broadcast/` or `*.lock` artifacts.
4. **Pattern-correctness:** the `docs/GATE3-LOG.md` and `docs/GATE4-LOG.md`
   allowlist entries added to `check-addresses.mjs` were tested **both** ways — a
   full address inside `docs/GATE3-LOG.md` passes (exit 0), the same literal in a
   non-allowlisted `docs/` file fails (exit 1). A rule never tested both ways is
   presumed wrong.
5. **Drift check vs the registry:** `node infra/gen-addresses.mjs` regenerates
   `web/src/generated/addresses.gen.ts` byte-identically (`git diff --exit-code` =
   0); the registry parses; every contract address in the deployment appears in the
   generated module.
6. **Honest report:** the three defects above are the full list of what this pass
   found and fixed. All three were wrong values quoted from a previous run rather
   than code defects, and all three ran in the direction of "the fixture claimed an
   audit trail it did not have" — which is why they were fixed rather than noted.
7. **Exit-code discipline:** every command's status was read from the tool itself,
   never after a pipe.
8. **User sign-off:** pending — the design lead walks `/race` and `/verify` in a
   browser against the deployed stack before this gate is declared closed.

---

## Verdict

**AUDITED, pending user sign-off.** The verifier formula is confirmed correct
against the live chain by independent re-derivation, the animation is
deterministic, and the three fixture defects that would have made the verifier
prove results from wrong inputs are fixed and re-verified.
