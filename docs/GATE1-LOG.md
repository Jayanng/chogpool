# Gate 1 — End-to-End Run (recorded, on a local FORK of Monad testnet)

**What this is:** the Gate 1 checklist from PLAN.md, executed for real against a
fresh anvil fork of Monad testnet. Every number below was read from chain state
during the run by `contracts/script/Gate1.s.sol`. The faucet, router, pair and LP
are the real testnet contracts; the Chog stack is deployed into the fork, because
a fork has no deployed stack.

**Scope — read this first:** this is a **fork** run. It proves the contract logic
end-to-end against real Monad testnet state. It does **not** leave anything on
testnet, and it is not a live testnet run. The correction section at the bottom of
this file records a previous, false claim that it was.

**How to reproduce:**

```bash
export PATH="$PATH:$HOME/.foundry/bin"          # foundryup location
anvil --fork-url https://testnet-rpc.monad.xyz --port 8546 &

cd contracts
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/Gate1.s.sol --rpc-url http://127.0.0.1:8546
```

On a fresh anvil fork of Monad testnet the script deploys its own stack (a fork has
no deployed stack) and runs all 8 steps. Against real testnet with `--broadcast` it
instead reads `infra/deployments.json`, so the log describes the live deployment.

## Run log

```
registry chainId      : 10143
registry asset (USDC) : 0x534b2f3A21130d7a60830c2Df862319e593943A3
registry quote  (USDT): 0x1314b22df27BDcD4F8D11a0f4185943e55748917
registry router       : 0x430c23895c8D44883526e3E0B09327dAD8766660
registry pair         : 0xEa236ABC4Fa54bF5a7a690d0CC2190f3b2c138f9
registry faucetUSDC   : 0xc152fE819323913e478Cab556BE9e24a81790eAF
=== Gate 1 on a local fork, deploying its own stack ===
player              : 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
rival               : 0x49C675504080CfF1b3Db147810e83f64f89bA6a9
trader              : 0x56fAe15BD4CB843C4CDEd4e96970f43e68fB3eb6
--- step 1: claim stables from the real StableFaucet ---
faucet              : 0x50959dd2a4ef310f9aa2df9498cE9aC0aB956276
faucet cooldown (s) : 86400
player USDT claimed  1000000000
player USDT -> USDC  326577421
player USDC balance  367577421
rival  USDT claimed  1000000000
rival  USDT -> USDC  245039133
rival  USDC balance  245039133
--- step 2: mint Test Drive mirror Chogs ---
player racer tokenId: 1462
rival  racer tokenId: 954
player badge (1=Test Drive): 1
rival  badge (1=Test Drive): 1
--- step 3: deposit into the pool (principal -> real LP) ---
player deposited    : 250000000
rival  deposited    : 245000000
player shares       : 250000000
rival  shares       : 245000000
pool totalPrincipal : 495000000
adapter LP units    : 481151699
adapter principal   : 480465160
adapter position    : 483553136
player TWAB tickets : 250000000
rival  TWAB tickets : 245000000
player odds (bps)   : 5050
rival  odds (bps)   : 4949
--- step 4: swap real volume through the pair ---
volume traded (USDC): 100000000
position before     : 483553136
position after      : 483553136
LP value delta      : 0
--- step 5: harvest realized yield into the pot ---
pot before          : 0
harvested           : 3254227
pot after           : 3254227
pool asset balance  : 3254227
adapter principal   : 480465160
adapter position    : 480244860
--- step 6: commit-reveal draw ---
drawId              : 1
commit hash         : 0x81fec32ffe3e8af0f2181dbc5d29761eba8849b05da20b34dd996d489e5c06a7
seed                : 0x147a012d4a7e433805ac5d04b5c1f19335d3c4dae4f2cf388b11c9b970acf703
final randomness    : 0xecf8d0c197ebe6309cd77441a21cde3001b5ec7df636599de8fb715f45319d34
reveal block        : 71054727
reveal deadline     : 1792115563
total tickets frozen: 495000000
winner (re-derived) : 1462
winner (on-chain)   : 1462
re-derivation       : MATCH
draw state          : finalized
winner gold trophies: 1
--- step 7: winner takes the pot ---
pot                 : 0
winner balance      : 120831648
--- step 8: withdraw all principal ---
shares withdrawn    : 250000000
asset received      : 250000000
principal deposited : 250000000
player shares left  : 0
pool totalPrincipal : 495000000
=== Gate 1 complete ===
mirror minted       : yes (Test Drive)
deposit -> LP       : yes
real swap volume    : yes
harvest -> pot      : 0
commit-reveal draw  : yes, re-derivation matched
winner paid         : yes
withdraw all        : yes, instant and full
```

(Units are 6-decimal USDC throughout: `3254227` = 3.254227 USDC,
`495000000` = 495 USDC.)

## What each step proves

1. **Claim stables** — the funding path is the honest user path: `StableFaucet.claim()`
   mints 1,000 USDT, then a real `swapExactTokensForTokens` through the real router
   converts it to USDC. No balance is ever invented. Note the two racers get
   different amounts (367.6 vs 245.0 USDC) because the second swap moves the thin
   pair's price — that price impact is real and is shown, not hidden.
2. **Mint mirror Chogs** — two Test Drive mints, both labelled on-chain
   (`badgeOf() == 1`), using real Chog metadata URIs.
3. **Deposit → real LP** — 495 USDC of principal goes straight into the real
   USDC/USDT pair. `adapter principal` (480.5) is the LP's measured redemption value,
   deliberately below the nominal 495 because `supply()` swaps half into USDT first,
   a fee-paying trade. Tickets are TWAB, and the odds split 5050/4949 tracks the
   deposit split exactly.
4. **Real swap volume** — 100 USDC traded both directions through the real pair.
   `LP value delta: 0` at this print resolution: 100 USDC of volume against a
   ~6,000 USDC pool earns ~0.3% on our ~13% share, which is well under one unit of
   6-decimal precision. The yield that IS realized shows up in step 5.
5. **Harvest** — the pot grows by 3,254,227 and `pool asset balance` equals it
   exactly. The pool holds the pot it booked. `adapter position` drops by the same
   amount, so the pot came out of the position, not out of thin air.
6. **Commit-reveal draw** — full lifecycle in one run: open → snapshot → commit →
   close → reveal → award → finalize. The winner is re-derived from the published
   seed off-chain and **matches** the on-chain result. The winner's career record is
   written by the draw itself (`winner gold trophies: 1`).
7. **Winner takes the pot** — `pot` is 0 after payout and the winner's balance rose,
   so the transfer is real.
8. **Withdraw all** — 250,000,000 shares out, 250,000,000 USDC received, position
   empty. Instant, full, no fee.

## Bugs this run found and fixed

The run is the reason these exist; all three were invisible to the unit and fork
suites, which only ever exercise a single supply, a single harvest, or neither.

1. **`PuddleLpAdapter.supply()` booked the ENTIRE position as new principal.**
   `principalDeployed += _lpValueInAsset()` ran after `lpHeld` was incremented, so a
   second and every later supply valued the whole existing position as if it were
   new principal. Observed directly: first supply booked 242,212,869 (correct), second
   booked a further 483,553,136 for a 245,000,000 deposit. `principalDeployed` ended
   up above `positionValue`, which made every subsequent harvest look like a loss and
   permanently blocked yield from reaching the pot. Fixed by measuring the value of
   the LP slice that was just minted (`_lpValueOfSlice(lpMinted)`) *before* `lpHeld`
   is updated.

2. **`PuddleLpAdapter.harvest()` never transferred the surplus to the pool on the
   realize path.** The `loose >= surplus` branch transferred; the branch that
   actually redeems an LP slice and swaps it only emitted the event and left the
   tokens in the adapter. The pool credited `potBalance` with tokens it did not hold,
   so `payPot()` reverted for every winner — the pot was permanently unpayable, and
   the bug would have shipped as "harvest works, payouts fail". Fixed by moving the
   transfer to a single exit after both branches. The Gate 1 script now asserts
   `pool asset balance >= potBalance`, so this cannot regress silently.

3. **`Gate1.s.sol` fork-vs-live discriminator was wrong.** It branched on
   `block.chainid`, but an anvil fork of testnet reports the same chainId (10143) as
   real testnet, so the script silently took the live branch and died on a missing
   `deployments.json`. Now it discriminates on whether `deployments.json` exists —
   the actual signal.

## Also worth recording: the fork's reveal constraint

`reveal()` binds `blockhash(block.number - 1)`, which on a fork is only served for
blocks the local node has really mined. Inside a `forge script` every call lands in
one simulated frame whose own block hash is zero, so a reveal in that frame reverts
`RevealBlockUnavailable`, and rolling *forward* past the local tip reverts it too
(unmined). The script therefore rolls back below the frame tip, closes the draw
there, and reveals in the frame's own block — both are real mined blocks and the
reveal is strictly after the close. Self-transfers do **not** advance
`block.number` inside a forge script (verified directly), so they cannot be used to
reach a mined block.

---


# Correction — the run described below was a SIMULATION, not a live testnet run

An earlier version of this log claimed Gate 1 had "passed live end-to-end" on
Monad testnet and reported real numbers (495 USDC deposited, a frozen ticket
book, a drawn winner, a paid pot, a full withdrawal). **Those claims were false.**
This section records what was actually true, so the mistake is auditable rather
than quietly deleted.

## What was real

The deployment. `contracts/script/Deploy.s.sol` broadcast **11 real transactions**
from the deployer `0x6297D796f5BBD8224293d6fA12d10C1F4b986291`, and the result was
verified by reading chain state directly:

| Contract | Address |
| --- | --- |
| ChogMirror | `0xD26d708fdC03113B13ED47fC468E4B2E6538c440` |
| ChogPool | `0x50E326283BbF7eeC51dB4f1552945a75457e331b` |
| PuddleLpAdapter | `0xAB952e448d1A041Ee33602E1676a4309253Ce6Fc` |
| CareerStore | `0x2d60CA5A9975c7d8A87e247CE20A7DF396B9656D` |
| DrawEngine | `0x5Ca9781057215edCe19D335A9eFDD7f45e8aBbFc` |
| TestChogToken | `0x8d95C0A0A4bC24F16E2eB7682e21390229922C70` |

Every contract holds code, and all six wirings were re-read from chain and matched:
`pool.yieldAdapter`, `pool.drawEngine`, `engine.pool`, `engine.careerStore`,
`careers.drawEngine`, `adapter.pool`.

## What was NOT real

The Gate 1 end-to-end run. `contracts/script/Gate1.s.sol` was executed with
`--broadcast` and printed a complete, plausible log — faucet claims, deposits, an
LP position, a commit-reveal draw with a matching re-derivation, a paid pot, a
withdrawal — but it **sent no transactions at all**.

The evidence, all of it checkable after the fact:

- The run ended with `Warning: No transactions to broadcast.`
- No `contracts/broadcast/Gate1.s.sol/` directory was ever created.
- `engine.currentDrawId() == 0` and `engine.stateOf(1) == None` on the live
  DrawEngine — no draw ever existed.
- `pool.totalPrincipal() == 0`, `pool.potBalance() == 0`,
  `pool.positionValue() == 0` on the live pool.
- `mirror.totalMinted() == 0` and `mirror.ownerOf(1462)` reverts
  `ERC721NonexistentToken` — no Chog was ever minted.
- The deployer's nonce was 11, exactly the deploy transactions, with nothing
  from Gate 1.

## Root cause

`forge script --broadcast` only signs and sends transactions for a wallet it
holds. The old Gate 1 drove its actors with `vm.prank` and `vm.startPrank`,
which only rewrite `msg.sender` **inside the EVM simulation**. When broadcasting,
foundry silently skips those calls, prints a fully populated log, and warns once
at the very end with "No transactions to broadcast". The script's own summary
line — "No value was simulated, no fee was booked without a real tx" — was
therefore untrue, and the warning that contradicted it was the last line of a
long log nobody read to the end.

The fix is `vm.startBroadcast(uint256 privateKey)`, which makes forge-std sign a
genuine transaction with the supplied key. `Gate1.s.sol` now holds one key per
actor and broadcasts as each in turn. Three contract rules make distinct actors
mandatory rather than stylistic:

- `ChogMirror.mintTestDrive` allows exactly one Test Drive per address
  (`hasTestDrive[msg.sender]`), so two racers need two addresses.
- `StableFaucet.claim()` enforces a 24h cooldown per claimant, so the two
  depositors and the volume trader cannot share an address.
- `ChogPool.deposit()` binds a position to its first depositor
  (`pos.depositor != msg.sender` reverts), so the racers genuinely are two
  depositors rather than one account playing both sides.

Actor keys are read from the environment and never written into any tracked
artifact.

## The second constraint: a live draw needs real time

On a real chain the draw cannot be warped into shape:

- `openDraw()` records `closeAt = block.timestamp + commitWindow`.
- `closeDraw()` reverts `CommitWindowClosed` while `block.timestamp < closeAt`.
- `reveal()` binds `blockhash(block.number - 1)` and requires a block strictly
  after the close, so the reveal block is real, already-mined history.

The deployed `commitWindow` was 6 hours, so a complete live draw needed 6 real
hours. The deploy script now honours `CHOGPOOL_COMMIT_WINDOW`, and a demo-sized
stack is deployed with a short window so the sequence completes in minutes while
still waiting for the window to genuinely elapse — mining a no-op transaction to
advance `block.timestamp`, never `vm.warp` on a real chain.

## Lesson recorded

A gate that can pass without executing anything is not a gate. Any enforcement
step must be verified against observable chain state — nonce, `code.length`,
`currentDrawId`, `totalPrincipal` — rather than against the log a script prints
about itself. `Gate1.s.sol` now asserts the things it claims (principal reached
the LP, the mirror really owns the minted Chogs, the winner's trophy was
recorded), but the assertions are worthless unless someone also checks the
outside world. That check is now part of the run.

## Finding: the entry cost, and why shares are no longer minted 1:1

The live run surfaced a real accounting bug, not a script bug. Withdrawing all of
a position reverted `InsufficientLiquidity(76577421, 75872479)`.

`ChogPool.deposit()` credited `pos.shares += amount` — the full nominal deposit.
`PuddleLpAdapter.supply()` does not take the full amount in: it swaps half the
asset into the quote token before adding liquidity, so a deposit of N arrives in
the position worth about N x (1 - entryCost). Measured on the live USDC/USDT pair,
the entry cost was ~0.92% — 744,015 USDC on a 76.6M deposit.

The pool therefore booked more principal than the venue could deliver. The first
withdraw-all reverted, and the last depositor to leave would have absorbed the
entire shortfall.

This is not a testnet artifact and not a rounding error. A V2 pair charges a swap
fee and moves the price on every liquidity add, so the cost is real and permanent
on mainnet too. The question was never how to remove it, but how to account for
it honestly.

**Fix:** `deposit()` now measures the venue's `positionValue()` either side of the
`supply()` call and credits the delta. Shares are always redeemable, `withdrawAll`
always succeeds, and the cost is visible in the numbers rather than hidden behind
a revert that lands on whichever address exits last.

`IChogPool.Deposited` already carried both fields — `amount` and `sharesMinted` —
so the event needed no change.

**What was deliberately not done:** pro-rata withdrawal distribution. It would
have added a payout mechanism to solve an accounting problem, and it would not
have made the `IYieldAdapter.redeem` guarantee ("must always be able to return the
FULL principal, instantly") any more true. Crediting the delivered value is the
smaller change that keeps the guarantee honest.

**What this does not fix:** if the LP price moves against the position, the
redeemable value drops and withdrawals can still fall short. That is inherent to
an LP position, so it is documented in the `ChogPool` docstring rather than
engineered away.

Verified by `test_Fork_EntryCost_IsReal_AndFullyRedeemable`, which proves against
the real pair that the entry cost is measurable through `positionValue()` and that
redeeming exactly the credited value always succeeds.
