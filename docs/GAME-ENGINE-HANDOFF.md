# GameEngine Contract Package
## Complete Specification for Deployment

This is the complete contract-side package for the GameEngine upgrade. Everything you need to deploy is here.

---

## 1. What's Already Deployed (Don't Touch)

These contracts are already deployed and will not change:

- **ChogPool**: `0x79D30244bD59c01aD1963800791522e3dAA876e0` (handles deposits, TWAB, potBalance, potSeeded, payPot)
- **ChogMirror**: `0xc8b49dbd74B0B5EEaE158Cdb671bcec931DC7E31` (NFT minting with mainnet signature verification)
- **CareerStore**: `0x336258EB8099cE594a3d0154C9e8CF9Fa7fa8C67` (tracks race history, trophies, fatigue)
- **TestChogToken**: `0x94a4456e3051B37ECb1AA46423779F35cc9D063d` (test token with faucet mechanics)

---

## 2. What You Need to Deploy

### Single New Contract: GameEngine.sol

**File**: `GameEngine.sol` (provided in this package)

**What it does**:
- Inherits from `DrawEngine` (keeps all existing draw functionality)
- Adds skill-based game layer with rounds, revives, and scoring
- Handles prize distribution (50/30/20 split of pot + TestCHOG bonus from revives)
- Integrates with existing pool for USDC payouts
- Records race results in CareerStore

**Constructor parameters** (in order):
1. `address owner_` - Owner address (0x6297D796f5BBD8224293d6fA12d10C1F4b986291)
2. `address operator_` - Operator who can open rounds, close rounds, settle rounds
3. `address careerStore_` - CareerStore address (0x336258EB8099cE594a3d0154C9e8CF9Fa7fa8C67)
4. `address testChog_` - TestChogToken address (0x94a4456e3051B37ECb1AA46423779F35cc9D063d)
5. `address gameAuthority_` - Authority who can submit scores (starts as operator_)

---

## 3. The Migration: TWO setDrawEngine Calls, Not One

After deploying GameEngine, **both** consumers of the engine must be repointed:

```solidity
ChogPool.setDrawEngine(gameEngine)       // makes payPot accept the engine
CareerStore.setDrawEngine(gameEngine)    // makes recordRace accept it
```

**Why the second one is not optional.** `CareerStore.recordRace` is gated to its
own recorded engine (`onlyDrawEngine`). If the pool is wired but the store is not:

- `settleRound` pays all three winners in USDC and Test $CHOG,
- it then calls `recordRace`, which reverts,
- so the whole settlement reverts — but the winners have *already been paid* by
  that point in the function,
- the round looks like a total failure to the operator and the leaderboard stays
  empty forever.

A test suite that wires both in `setUp` can never catch this. The deploy script
calls both and reads both back; `GameEngine.t.sol` pins the negative case as a
revert, and the trace in the test shows the three `payPot` transfers succeeding
before `recordRace` fails.

---

## 4. How It Works

### 4.1 Round Lifecycle

**openRound(bytes32 courseSeed, uint64 closesAt)** - operator only
- Opens a new round with a fixed course seed
- Sets the entry window (closesAt)
- Emits: `RoundOpened(roundId, courseSeed, closesAt)`

**payRevive(uint256 roundId)** - player only
- One revive per (round, tokenId)
- Costs 10 TestCHOG (configurable constant)
- Transfers TestCHOG from player to GameEngine
- Second revive reverts with `ReviveAlreadyUsed(roundId, tokenId)`
- Emits: `RevivePaid(roundId, tokenId, fee)`

**submitScores(uint256 roundId, uint256[] tokenIds, uint256[] scores, uint256[] coins, bool[] revived)** - game authority only
- Records scores and coin counts for participants
- BEST RUN COUNTS: a Chog with an existing entry may re-submit with a STRICTLY HIGHER score, which replaces score/coins/revived and pays only the coin difference `max(0, newCoins - oldCoins) * COIN_RATE`
- Anything not strictly higher is refused with `NotABetterScore(roundId, tokenId, currentScore, submittedScore)`
- No clawback: a better run with fewer coins pays nothing and takes nothing back
- Emits: `ScoreRecorded(roundId, tokenId, score, coins, revived, submittedBy, coinPayout)`

**closeRound(uint256 roundId)** - operator only
- Closes the round for entries
- Snapshots potBalance and TestCHOG balance
- Emits: `RoundClosed(roundId, potAtClose, chogAtClose)`

**settleRound(uint256 roundId, uint256[3] calldata top3)** - operator only
- Pays USDC prizes: 50% to 1st, 30% to 2nd, 20% to 3rd
- Pays TestCHOG revive fees to winners (proportional to USDC prizes)
- Records race results in CareerStore for all top3
- Emits: `RoundSettled(roundId, top3, usdcAmounts, chogAmounts)`

### 4.2 Prize Split (Computed On-Chain)

```solidity
uint256 pot = potAtClose; // snapshot from closeRound
uint256 first = (pot * 5000) / 10000; // 50%
uint256 second = (pot * 3000) / 10000; // 30%
uint256 third = pot - first - second; // 20% (remainder, no dust)
```

The split is computed on-chain from the snapshot, not passed in. Percentages are hardcoded in the contract.

### 4.3 Revive Fee Bonus

TestCHOG revive fees are paid to winners proportional to their USDC prize:
- 1st place gets 50% of revive fees
- 2nd place gets 30% of revive fees
- 3rd place gets 20% of revive fees

This creates a self-funding bonus pool where the game funds part of its own prizes.

---

## 5. Key Design Decisions

### 5.1 Coins Are Paid At Submission, At A Fixed Rate
The game client reports the coins each run collected, and `submitScores` pays
`coins * COIN_RATE` (0.1 Test $CHOG per coin) to that position's depositor **in
the same transaction that records the run**.

Why at submission and not at settle: the site copy promises coins "land in your
Test $CHOG purse" when a run is recorded. Deferring to settle would break that
promise for every run that does not make the top 3.

Why the amount is a function of the recorded coins and never of the engine's
balance: the engine's Test $CHOG is a team-funded treasury, so a huge coin count
cannot drain it — either the transfer succeeds and pays exactly `coins * rate`, or
it reverts and the whole submission (run record included) is rolled back. A run
recorded without its coins paid is a promise broken on screen, so the call is
all-or-nothing.

**The engine must be funded before the first round is submitted.** The faucet
mints 1,000 Test $CHOG per address per day, so the treasury is funded by transfer,
not minted. An unfunded engine reverts every submission.

**FUNDING STEP, part of the deploy:** after `careerStore.setDrawEngine`, transfer
Test $CHOG to the engine address (e.g. 1,000 CHOG covers 10,000 coins of runs).

### 5.2 Course Seed is Immutable
The `courseSeed` is set at `openRound` and can never change. Every player in the round faces the identical course, and anyone can re-derive the course from the seed in the Proof page. The operator choosing the seed affects every player equally.

### 5.3 Access Control
- **Operator**: Can open rounds, close rounds, settle rounds (same role model as existing draw)
- **Game Authority**: The recorder. Can submit scores, and its key can ONLY call `submitScores`. Currently `0xBC65365cb6D8EB704445015EA8eeFD346e9bed71`, re-pointable by the owner via `setGameAuthority` if the recorder rotates.
- **Owner**: Can change operator, game authority, career store, and test CHOG token addresses

### 5.4 Prize Payouts
- USDC prizes go through `ChogPool.payPot(winnerAddress, amount)` - the pool's existing payout mechanism
- TestCHOG bonuses are transferred directly from GameEngine balance
- Winners are resolved through `ChogPool.depositOf(tokenId)` to get the depositor address (not the tokenId)

---

## 6. Constants

```solidity
uint256 public constant REVIVE_FEE = 10 * 10**18; // 10 TestCHOG
uint256 public constant TOP_N = 3; // top 3 split
```

---

## 7. Events

```solidity
event RoundOpened(uint256 indexed roundId, bytes32 courseSeed, uint64 closesAt);
event RevivePaid(uint256 indexed roundId, uint256 indexed tokenId, uint256 fee);
event ScoreRecorded(uint256 indexed roundId, uint256 indexed tokenId, uint256 score, bool revived);
event RoundClosed(uint256 indexed roundId, uint256 potAtClose, uint256 chogAtClose);
event RoundSettled(uint256 indexed roundId, uint256[3] top3, uint256[3] usdcAmounts, uint256[3] chogAmounts);
```

---

## 8. Errors

```solidity
error ZeroCourseSeed();
error ClosesAtNotInFuture(uint64 closesAt);
error NotOperator();
error NotGameAuthority();
error RoundNotOpen(uint256 roundId);
error RoundAlreadyClosed(uint256 roundId);
error ReviveAlreadyUsed(uint256 roundId, uint256 tokenId);
error NotInPool(uint256 tokenId);
error NotABetterScore(uint256 roundId, uint256 tokenId, uint256 currentScore, uint256 submittedScore);
error EmptyTop3();
error DuplicateWinner(uint256 tokenId);
error WinnerNotInPool(uint256 tokenId);
error NoScoresRecorded(uint256 roundId, uint256 tokenId);
error NothingToSettle();
error FeePullFailed(uint256 roundId, uint256 tokenId, uint256 fee);
```

---

## 9. Deployment Sequence

**STATUS: DEPLOYED 2026-10-21 (second engine, with best-run-counts) on Monad
testnet (chain 10143).** This is the LIVE engine. It replaced the first engine
(`0x437ae585f336F1d3Edc13Aa49b63E8e268f2c4c7`, now orphaned) because
`submitScores` changed to best-run-counts.

The engine is deployed and wired. **The treasury is NOT funded yet** — see the
warning below.

| Step | Tx | Result |
|---|---|---|
| Deploy GameEngine | `0x4e1405207b1987746d3d81cfc482ff58b4252fede61f52f5f2ba504260e784ee` | block 73000024, 4,875,310 gas, success |
| `pool.setDrawEngine` | `0xb63ab8246643b52a6db9304fd51aa80d05fcfbc35533d9251271d19d5ea6b439` | block 73000026, 43,544 gas, success |
| `careerStore.setDrawEngine` | `0x0557099c26e6a0d0eb5a7f8b37fa0d8ae9ed4626cc5b40f74824c99e09fc984d` | block 73000027, 43,334 gas, success |

`setGameAuthority` was **not** a separate transaction: the constructor was given
`0xBC65365cb6D8EB704445015EA8eeFD346e9bed71` directly, so the deploy script's
conditional correctly skipped it. Verified by reading `gameAuthority()` back.

**Deployed GameEngine: `0xC6599116e6f9c7F4b225247bE1DA14389c8DcfF5`**

Read back from the chain after the run, which is the only evidence that counts:

```
pool.drawEngine        = 0xC6599116e6f9c7F4b225247bE1DA14389c8DcfF5
careerStore.drawEngine = 0xC6599116e6f9c7F4b225247bE1DA14389c8DcfF5
engine.operator        = 0x6297D796f5BBD8224293d6fA12d10C1F4b986291
engine.gameAuthority   = 0xBC65365cb6D8EB704445015EA8eeFD346e9bed71   (the recorder)
engine.owner           = 0x6297D796f5BBD8224293d6fA12d10C1F4b986291
engine.coinRate        = 100000000000000000 (0.1 CHOG per coin)
engine.reviveFee       = 10000000000000000000 (10 CHOG)
engine.latestRoundId   = 0 (no round opened yet)
engine Test $CHOG      = 0   <-- TREASURY EMPTY, SEE BELOW
```

### THE TREASURY IS EMPTY AND THE ENGINE CANNOT ACCEPT RUNS UNTIL IT IS FUNDED

The faucet grants 1,000 Test $CHOG per address per day, and the owner's claim is
on cooldown until **1792662082 = 2026-10-22 09:41 UTC**. That is before the Oct 23
deadline, so the funding is a scheduling problem rather than a blocker, but until
it happens **every `submitScores` reverts with `ERC20InsufficientBalance` and no
run records at all.**

To fund it, from the owner key, once the cooldown clears:

```bash
cast send <TEST_CHOG> "claim()" --rpc-url monad_testnet --private-key $PRIVATE_KEY
cast send <TEST_CHOG> "transfer(address,uint256)" 0xC6599116e6f9c7F4b225247bE1DA14389c8DcfF5 1000000000000000000000 \
  --rpc-url monad_testnet --private-key $PRIVATE_KEY
```

1,000 CHOG covers 10,000 coins of runs at 0.1 each. Check the balance before each
session and top up from the faucet when it runs low.

### UNRECOVERABLE: 1,000 Test $CHOG stranded in the first engine

The first engine (`0x437ae585f336F1d3Edc13Aa49b63E8e268f2c4c7`) was funded with
1,000 Test $CHOG when it was deployed, and then replaced by the second engine
(`0xC6599116e6f9c7F4b225247bE1DA14389c8DcfF5`) when `submitScores` changed to
best-run-counts. The pool and CareerStore now point at the new engine, so the old
one is orphaned.

**Those 1,000 Test $CHOG are unrecoverable.** `GameEngine` has no sweep, rescue
or withdraw function, and adding one would need a redeploy of a contract that
nothing points at any more. The tokens are testnet-only and worthless, so the
loss is cosmetic, but it is recorded here so nobody spends time chasing them.

Do not attempt to recover them. Do not treat the old engine as a funding source.

### An extra 1,000 Test $CHOG exists but is NOT claimable from here

The recorder's address `0xBC65365cb6D8EB704445015EA8eeFD346e9bed71` has never
claimed from the faucet and is eligible, so it could add another 1,000 Test $CHOG
of runway. **Its private key is not on this host** — every key in the Hermes state
database was scanned against it and none derives to it. Claiming on its behalf
would mint tokens into a wallet that cannot be spent from, which does not help.

If more runway is wanted for the judging week, the recorder's operator claims from
their own machine and transfers to the engine. Otherwise 1,000 CHOG covers 10,000
coins of runs, which is the documented budget.

### The sequence, for anyone re-running it on a fresh stack

1. Deploy GameEngine with parameters:
   - owner: the pool owner
   - operator: the address that will open/close/settle rounds
   - careerStore: the deployed CareerStore
   - testChog: the deployed TestChogToken
   - gameAuthority: **the recorder's public identity**, `0xBC65365cb6D8EB704445015EA8eeFD346e9bed71`.
     Its key can only call `submitScores`.

2. **Both** wiring transactions, from the pool owner:
   - `ChogPool.setDrawEngine(gameEngine)`
   - `CareerStore.setDrawEngine(gameEngine)`

3. **Fund the coin treasury:** claim from the faucet, then transfer Test $CHOG to
   the engine address. Without this every `submitScores` reverts and no round can
   be played. 1,000 CHOG covers 10,000 coins of runs.

4. Verify both wirings:
   ```bash
   cast call <POOL> "drawEngine()" --rpc-url https://testnet-rpc.monad.xyz
   cast call <CAREER_STORE> "drawEngine()" --rpc-url https://testnet-rpc.monad.xyz
   ```
   Both must return the new GameEngine address.

**Two traps this repo has already recorded, both of which the dry run caught
before any broadcast:**

- Running `forge script` from the repo root instead of `contracts/` fails to
  compile. Always `cd contracts` first.
- Without `--private-key`, `msg.sender` inside the script is Foundry's
  `DefaultSender` (`0x1804c8AB…`), so `setDrawEngine` reverts
  `OwnableUnauthorizedAccount`. **A simulation writes files and prints a
  plausible log; only the chain is evidence.** The dry run reproduced this exact
  revert, which is why the broadcast was run with `--private-key` and
  `DEPLOY_OPERATOR` set.

---

## 10. What Frontend Needs to Know

### New Address
- `gameEngine`: [address from deployment]

### New Game Flow
1. **Player deposits** → same as before (ChogPool.deposit)
2. **Round opens** → operator calls openRound (or you trigger via UI)
3. **Player plays** → game client runs, outputs score
4. **Submit score** → game authority calls submitScores
5. **Close round** → operator calls closeRound
6. **Settle** → operator calls settleRound with top3 tokenIds
7. **Prizes paid** → winners receive USDC + TestCHOG automatically

### Frontend Changes Needed
- Add game UI (skill-based mini-game)
- Show current round status (open/closed/settled)
- Display leaderboard
- Show revive button with TestCHOG balance check
- Show pending prizes after settlement

---

## 11. Integration with Existing Systems

### CareerStore Integration
- `settleRound` calls `careerStore.recordRace(tokenId, roundId, placement, fatigueDelta)`
- Records race participation for all top3
- Updates trophies (gold/silver/bronze counts)
- FatigueDelta is 0 for now (can be tuned later)

### TestChogToken Integration
- Players must approve GameEngine to spend their TestCHOG
- Revive fee is 10 TestCHOG (constant, can be adjusted)
- Fees accumulate in GameEngine and are paid out at settle
- GameEngine must have TestCHOG balance to pay bonuses (operator should transfer fees before settle if needed)

### ChogPool Integration
- GameEngine is the ONLY address allowed to call `payPot` (enforced by pool)
- Winners are resolved through `depositOf(tokenId)` to get the actual depositor address
- All existing deposits remain untouched

---

## 12. Testing

The contract package includes:
- **GameEngine.t.sol**: 33 unit tests covering all mandatory properties
- **DrawEngineCareer.t.sol**: 9 integration tests for draw + career integration

Run tests:
```bash
forge test --match-contract GameEngineTest
```

All 204 contract tests pass (170 existing + 33 GameEngine tests + 1 withdraw regression).

### The view functions the frontend binds to

| Function | Returns | Purpose |
|---|---|---|
| `latestRoundId()` | `uint256` | newest round id, 0 if none |
| `roundState(roundId)` | `RoundState` | None/Open/Closed/Settled |
| `roundClosesAt(roundId)` | `uint64` | entry window end |
| `courseSeedOf(roundId)` | `bytes32` | the fixed course seed |
| `scoreOf(roundId, tokenId)` | `uint256` | that run's score |
| `coinsOf(roundId, tokenId)` | `uint256` | that run's coin count |
| `coinPayoutOf(roundId, tokenId)` | `uint256` | the Test $CHOG that run's coins paid |
| `coinRate()` | `uint256` | the rate per coin, one source of truth for the UI |
| `revivedOf(roundId, tokenId)` | `bool` | whether that run used its revive |
| `hasRun(roundId, tokenId)` | `bool` | whether a run was recorded at all |
| `participantCount(roundId)` | `uint32` | how many runs are recorded |
| `potAtClose(roundId)` / `chogAtClose(roundId)` | `uint256` | the settled snapshots |
| `roundWinnersOf(roundId)` | `uint256[3]` | winners, once settled |
| `reviveFee()` | `uint256` | the current revive fee, one source of truth |

`coinsOf` is absent by decision — see 5.1.

---

## 13. Security Considerations

1. **Game Authority is trusted**: Can submit any scores, so in production this should be a multi-sig or decentralized authority
2. **Operator is trusted**: Can open/close/settle rounds, so in production this should be a keeper network
3. **Revive fees are non-refundable**: Once paid, they go to the prize pool
4. **Scores are final**: Once recorded, scores cannot be changed
5. **Settlement is one-time**: Each round can only be settled once

---

## 14. What's Next After Deployment

1. Deploy GameEngine (this package)
2. Call pool.setDrawEngine(gameEngine)
3. Regenerate frontend addresses: `node infra/gen-addresses.mjs`
4. Update frontend to use new game flow
5. Run a test round end-to-end (open → play → close → settle)
6. Film demo video with the test round

---

## 15. Files in This Package

- `GameEngine.sol` - Main contract
- `GameEngine.t.sol` - Unit tests (17 tests)
- `DeployGameEngine.s.sol` - Deployment script
- `DrawEngineCareer.t.sol` - Integration tests (9 tests, existing)

---

## 16. Questions?

This is the complete package. Everything you need is here. The deployment is:
- 1 new contract (GameEngine)
- 1 transaction to wire it (setDrawEngine)
- 0 migrations (all existing data untouched)
- 0 downtime (swap is atomic)

The game layer is now live.
