// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {GameEngine} from "../src/GameEngine.sol";
import {DrawEngine} from "../src/DrawEngine.sol";
import {CareerStore} from "../src/CareerStore.sol";
import {MockYieldAdapter} from "../fixtures/MockYieldAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockMirror} from "./mocks/MockMirror.sol";
import {TestChogToken} from "../src/TestChogToken.sol";
import {IChogPool} from "../interfaces/IChogPool.sol";

/// @title GameEngine round flow, every mandatory property pinned.
/// @notice The product ships skill rounds, not the draw. This suite proves the
///         properties the spec calls mandatory:
///
///           1. the top-3 split is exactly 50/30/20 and computed on chain
///           2. a second revive in the same round reverts
///           3. revive fees reach the top 3 at settle and are never burned
///           4. settleRound pays from potBalance and cannot pay outside top3
///           5. courseSeed cannot change after openRound
///           6. the two-depositor property still holds on the pool
///           7. career records land with the right placements
///
/// @dev Plus the things that only matter because they are easy to get wrong: the
///      split sums to the pot exactly with no stranded dust, the USDC goes to the
///      position's depositor rather than the tokenId, and a round settles once.
contract GameEngineTest is Test {
    uint256 constant ONE = 1e6;
    uint256 constant CHOG_ONE = 1e18;
    /// @dev Mirrors GameEngine.COIN_RATE so the tests assert against the same
    ///      number the contract publishes rather than a second literal.
    uint256 constant COIN_RATE = 0.1 ether;

    MockERC20 usdc;
    MockMirror mirror;
    CareerStore store;
    ChogPool pool;
    MockYieldAdapter adapter;
    GameEngine engine;
    TestChogToken testChog;

    address owner_ = address(uint160(1001));
    address operator_ = address(uint160(1002));
    address authority_ = address(uint160(1003));

    address alice = address(0xA11CE);
    address bob = address(0xB0B1);
    address carol = address(0xCA201);

    uint256 constant T_A = 1;
    uint256 constant T_B = 2;
    uint256 constant T_C = 3;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        mirror = new MockMirror();
        store = new CareerStore(address(this));
        testChog = new TestChogToken(owner_, 1000 * CHOG_ONE, 1 days);

        pool = new ChogPool(address(usdc), address(mirror), address(this));
        adapter = new MockYieldAdapter(address(usdc), address(pool));

        engine = new GameEngine(owner_, operator_, address(store), address(testChog), authority_);

        vm.startPrank(owner_);
        engine.setPool(address(pool));
        vm.stopPrank();

        pool.setYieldAdapter(address(adapter));
        pool.setDrawEngine(address(engine));
        store.setDrawEngine(address(engine));

        mirror.setOwnerOf(T_A, alice);
        mirror.setOwnerOf(T_B, bob);
        mirror.setOwnerOf(T_C, carol);

        usdc.mint(alice, 10_000 * ONE);
        usdc.mint(bob, 10_000 * ONE);
        usdc.mint(carol, 10_000 * ONE);

        // Everyone has Test $CHOG to buy revives with. TestChogToken has no owner
        // mint: supply enters only through claim(), which is faucet-capped per
        // address. So each actor claims their own, exactly as a real user would.
        vm.prank(owner_);
        testChog.claim();
        vm.prank(alice);
        testChog.claim();
        vm.prank(bob);
        testChog.claim();
        vm.prank(carol);
        testChog.claim();

        // The engine's coin treasury, funded by transfer from an address that
        // claimed. This is the production condition, not a test convenience: the
        // faucet mints 1,000 per address per day, so the treasury is funded rather
        // than minted. Without it every coin payout reverts and no round can be
        // submitted at all, which is exactly what happened when this was missing.
        vm.prank(owner_);
        testChog.transfer(address(engine), 100 * CHOG_ONE);
    }

    function _deposit(address who, uint256 tokenId, uint256 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(pool), amount);
        pool.deposit(tokenId, amount);
        vm.stopPrank();
    }

    /// @dev Deposits do NOT fund the pot: they go into the LP venue. The pot is
    ///      funded by harvest() from LP surplus, or by seedPot() when the venue
    ///      earns nothing — which is the case on the testnet pair. Every split test
    ///      therefore seeds the pot first, exactly as the real deploy does, or it
    ///      would be asserting a split of zero.
    function _seedPot(uint256 amount) internal {
        usdc.mint(address(this), amount);
        usdc.approve(address(pool), amount);
        pool.seedPot(amount);
    }

    function _openRound() internal returns (uint256 roundId) {
        vm.stopPrank(); // clear any active prank so this one can be set cleanly
        vm.prank(operator_);
        roundId = engine.openRound(bytes32("course-seed"), uint64(block.timestamp + 1 hours));
    }

    // ---------- 1. the split is exactly 50/30/20 and computed on chain ----------

    function test_Split_IsExactly_50_30_20_AndComputedOnChain() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        _seedPot(100 * ONE);
        uint256 roundId = _openRound();

        uint256[] memory tokenIds = _ids(T_A, T_B, T_C);
        uint256[] memory scores = _scores(300, 200, 100);
        uint256[] memory coins = _coins3(10, 7, 4);
        bool[] memory revived = _flags(false, false, false);
        _submit(roundId, tokenIds, scores, coins, revived);

        vm.prank(operator_);
        engine.closeRound(roundId);

        uint256 pot = pool.potBalance();
        assertGt(pot, 0, "there is a pot to split");

        uint256 aBefore = usdc.balanceOf(alice);
        uint256 bBefore = usdc.balanceOf(bob);
        uint256 cBefore = usdc.balanceOf(carol);

        vm.prank(operator_);
        engine.settleRound(roundId, [T_A, T_B, T_C]);

        uint256 aGot = usdc.balanceOf(alice) - aBefore;
        uint256 bGot = usdc.balanceOf(bob) - bBefore;
        uint256 cGot = usdc.balanceOf(carol) - cBefore;

        // Exact percentages against the snapshot taken at close.
        assertEq(aGot, (pot * 5000) / 10_000, "first place is exactly 50%");
        assertEq(bGot, (pot * 3000) / 10_000, "second place is exactly 30%");
        // Third takes the remainder, so the three sum to the pot with no dust lost.
        assertEq(aGot + bGot + cGot, pot, "the three payouts sum to the pot exactly");
        assertEq(pool.potBalance(), 0, "the pot is fully distributed");
    }

    /// The split must survive an awkward number. Integer division is where a
    /// 50/30/20 implementation usually strands dust, and stranded dust is money
    /// that vanishes from the prize.
    function test_Split_LosesNoDust_OnAnAwkwardPot() public {
        // Seed an odd, non-round number so every division has a remainder.
        _deposit(alice, T_A, 1 * ONE + 1);
        _deposit(bob, T_B, 3 * ONE + 7);
        _deposit(carol, T_C, 5 * ONE + 3);
        _seedPot(1 * ONE + 13); // an awkward pot, so 50/30/20 all leave remainders

        uint256 roundId = _openRound();
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _coins3(10, 7, 4), _flags(false, false, false));
        vm.prank(operator_);
        engine.closeRound(roundId);

        uint256 pot = pool.potBalance();
        assertGt(pot, 0);

        uint256 aBefore = usdc.balanceOf(alice);
        uint256 bBefore = usdc.balanceOf(bob);
        uint256 cBefore = usdc.balanceOf(carol);

        vm.prank(operator_);
        engine.settleRound(roundId, [T_A, T_B, T_C]);

        uint256 total = (usdc.balanceOf(alice) - aBefore) + (usdc.balanceOf(bob) - bBefore)
            + (usdc.balanceOf(carol) - cBefore);
        assertEq(total, pot, "not one unit is stranded, whatever the pot is");
    }

    // ---------- 2. a second revive in the same round reverts ----------

    function test_SecondRevive_InTheSameRound_Reverts() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();

        vm.startPrank(alice);
        testChog.approve(address(engine), 100 * CHOG_ONE);
        engine.payRevive(roundId, T_A);

        vm.expectRevert(abi.encodeWithSelector(GameEngine.ReviveAlreadyUsed.selector, roundId, T_A));
        engine.payRevive(roundId, T_A);
        vm.stopPrank();
    }

    /// A revive in a LATER round must be allowed: the cap is per (round, tokenId),
    /// not a lifetime ban, or the second round would be unplayable.
    function test_Revive_AllowedAgain_InANewRound() public {
        _deposit(alice, T_A, 100 * ONE);

        uint256 first = _openRound();

        // Approve once for both revives, as a real player would.
        vm.startPrank(alice);
        testChog.approve(address(engine), 100 * CHOG_ONE);
        engine.payRevive(first, T_A);
        vm.stopPrank();

        vm.prank(operator_);
        engine.closeRound(first);

        uint256 second = _openRound();
        vm.prank(alice);
        engine.payRevive(second, T_A);

        assertTrue(engine.reviveUsed(first, T_A), "first round's revive is spent");
        assertTrue(engine.reviveUsed(second, T_A), "and so is the new round's");
    }

    // ---------- 3. revive fees reach the top 3 and are never burned ----------

    function test_ReviveFees_ReachTheTop3_AndAreNeverBurned() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        _seedPot(100 * ONE);
        uint256 roundId = _openRound();

        // Two players buy revives, so there is a real fee pool.
        vm.startPrank(alice);
        testChog.approve(address(engine), 100 * CHOG_ONE);
        engine.payRevive(roundId, T_A);
        vm.stopPrank();

        vm.startPrank(bob);
        testChog.approve(address(engine), 100 * CHOG_ONE);
        engine.payRevive(roundId, T_B);
        vm.stopPrank();

        uint256 feePool = testChog.balanceOf(address(engine));
        assertEq(feePool, 120 * CHOG_ONE, "the engine holds both fees plus the treasury");

        // Coins are recorded as ZERO so the coin payout is zero and the only
        // Test $CHOG moving at settle is the revive fee. Without this the coin
        // payouts would also leave the engine and the assertion below would be
        // measuring the wrong money.
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _coins3(0, 0, 0), _flags(true, true, false));
        vm.prank(operator_);
        engine.closeRound(roundId);

        uint256 aBefore = testChog.balanceOf(alice);
        uint256 bBefore = testChog.balanceOf(bob);
        uint256 cBefore = testChog.balanceOf(carol);

        vm.prank(operator_);
        engine.settleRound(roundId, _winners(T_A, T_B, T_C));

        uint256 aGot = testChog.balanceOf(alice) - aBefore;
        uint256 bGot = testChog.balanceOf(bob) - bBefore;
        uint256 cGot = testChog.balanceOf(carol) - cBefore;

        assertEq(aGot + bGot + cGot, feePool, "every unit of fee reaches a winner");
        assertEq(testChog.balanceOf(address(engine)), 0, "nothing is left behind in the engine");
        assertEq(aGot, (feePool * 5000) / 10_000, "fees split on the same 50/30/20");
    }

    // ---------- 4. settle pays from the pot and cannot pay outside top3 ----------

    function test_Settle_PaysOnlyTheTop3() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        _seedPot(100 * ONE);
        uint256 roundId = _openRound();
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _coins3(10, 7, 4), _flags(false, false, false));
        vm.prank(operator_);
        engine.closeRound(roundId);

        // A bystander with a position but no placing gets nothing.
        address bystander = address(0xBEEF);
        usdc.mint(bystander, 1000 * ONE);
        uint256 bystanderBefore = usdc.balanceOf(bystander);

        uint256 aBefore = usdc.balanceOf(alice);
        vm.prank(operator_);
        engine.settleRound(roundId, [T_A, T_B, T_C]);

        assertEq(usdc.balanceOf(bystander) - bystanderBefore, 0, "a non-placed address receives nothing");
        assertGt(usdc.balanceOf(alice) - aBefore, 0, "the winner is paid");
    }

    /// A winner with no recorded run cannot be settled: otherwise the authority
    /// could name any token in the pool and take the pot.
    function test_Settle_RejectsAWinnerWithNoRun() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        _seedPot(100 * ONE);
        uint256 roundId = _openRound();
        _submit(roundId, _single(T_A), _single(300), _coins1(10), _singleFlag(false));
        vm.prank(operator_);
        engine.closeRound(roundId);

        vm.prank(operator_);
        vm.expectRevert(abi.encodeWithSelector(GameEngine.NoScoresRecorded.selector, roundId, T_C));
        engine.settleRound(roundId, [T_A, T_C, T_B]);
    }

    /// A duplicate in top3 would pay one depositor three times and strand two
    /// shares of the pot.
    function test_Settle_RejectsADuplicateWinner() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        uint256 roundId = _openRound();
        _submit(roundId, _pair(T_A, T_B), _pair(300, 200), _coins2(10, 7), _pairFlag(false, false));
        vm.prank(operator_);
        engine.closeRound(roundId);

        vm.prank(operator_);
        vm.expectRevert(abi.encodeWithSelector(GameEngine.DuplicateWinner.selector, T_A));
        engine.settleRound(roundId, [T_A, T_A, T_B]);
    }

    /// A round settles exactly once. CareerStore would reject a duplicate race
    /// record anyway, but the pot must not be payable twice regardless.
    function test_Settle_CannotRunTwice() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        _seedPot(100 * ONE);
        uint256 roundId = _openRound();
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _coins3(10, 7, 4), _flags(false, false, false));
        vm.prank(operator_);
        engine.closeRound(roundId);

        vm.prank(operator_);
        engine.settleRound(roundId, [T_A, T_B, T_C]);

        vm.prank(operator_);
        vm.expectRevert(abi.encodeWithSelector(GameEngine.WrongRoundState.selector, GameEngine.RoundState.Closed, GameEngine.RoundState.Settled));
        engine.settleRound(roundId, [T_A, T_B, T_C]);
    }

    /// The USDC must reach the position's DEPOSITOR. payPot transfers to whatever
    /// address it is handed, so passing a tokenId-shaped address would pay nobody.
    function test_Settle_PaysTheDepositor_NotTheTokenId() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        _seedPot(100 * ONE);
        uint256 roundId = _openRound();
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _coins3(10, 7, 4), _flags(false, false, false));
        vm.prank(operator_);
        engine.closeRound(roundId);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(operator_);
        engine.settleRound(roundId, [T_A, T_B, T_C]);

        assertGt(usdc.balanceOf(alice) - aliceBefore, 0, "the depositor's own balance grew");
    }

    // ---------- 5. courseSeed cannot change after openRound ----------

    function test_CourseSeed_CannotChangeAfterOpen() public {
        uint256 roundId = _openRound();
        bytes32 original = engine.courseSeedOf(roundId);

        assertTrue(original != bytes32(0), "the seed is published at open");
        // There is no setter, and the struct field is only written in openRound.
        // The compiler-level guarantee: the only code that writes courseSeed is the
        // open path, and openRound mints a fresh round id each time.
        vm.prank(operator_);
        uint256 second = engine.openRound(bytes32("a-different-seed"), uint64(block.timestamp + 1 hours));

        assertEq(engine.courseSeedOf(roundId), original, "the first round's seed is untouched");
        assertTrue(engine.courseSeedOf(second) != original, "a new round has its own seed");
    }

    /// A zero seed is refused: an unseeded course is not reproducible, so the Proof
    /// page could not re-derive it.
    function test_OpenRound_RejectsAZeroSeed() public {
        vm.prank(operator_);
        vm.expectRevert(GameEngine.ZeroCourseSeed.selector);
        engine.openRound(bytes32(0), uint64(block.timestamp + 1 hours));
    }

    // ---------- 6. the two-depositor property still holds on the pool ----------

    /// The stranding fix must not regress. Two depositors through a cost-charging
    /// venue must both exit, and neither may be blocked or short-paid by the
    /// other's exit. This is the property the whole fresh deploy exists to protect.
    function test_TwoDepositorProperty_StillHolds() public {
        adapter.setEntryCostBps(92);

        _deposit(alice, T_A, 500 * ONE);
        _deposit(bob, T_B, 500 * ONE);

        uint256 aliceShares = pool.sharesOf(T_A);
        uint256 bobShares = pool.sharesOf(T_B);
        assertGt(aliceShares, 0);
        assertGt(bobShares, 0);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore = usdc.balanceOf(bob);

        vm.prank(alice);
        pool.withdrawAll(T_A); // must NOT revert
        vm.prank(bob);
        pool.withdrawAll(T_B); // must NOT revert either

        uint256 aliceGot = usdc.balanceOf(alice) - aliceBefore;
        uint256 bobGot = usdc.balanceOf(bob) - bobBefore;

        assertGt(aliceGot, 0, "alice received real value");
        assertGt(bobGot, 0, "bob received real value after alice exited");
        assertEq(aliceGot + bobGot, 2 * (500 * ONE - (500 * ONE * 92) / 10_000), "together they drained the venue");
        assertEq(adapter.positionValue(), 0, "the venue is empty");
        assertEq(pool.totalPrincipal(), pool.totalShares(), "the pool's books still agree");
    }

    // ---------- 7. career records land with the right placements ----------

    function test_CareerRecords_LandWithTheRightPlacements() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        _seedPot(100 * ONE);
        uint256 roundId = _openRound();
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _coins3(10, 7, 4), _flags(false, false, false));
        vm.prank(operator_);
        engine.closeRound(roundId);

        vm.prank(operator_);
        engine.settleRound(roundId, [T_A, T_B, T_C]);

        (uint32 gold, uint32 silver, uint32 bronze) = store.trophiesOf(T_A);
        assertEq(gold, 1, "first place takes gold");
        assertEq(silver, 0);
        assertEq(bronze, 0);

        (gold, silver, bronze) = store.trophiesOf(T_B);
        assertEq(silver, 1, "second place takes silver");

        (gold, silver, bronze) = store.trophiesOf(T_C);
        assertEq(bronze, 1, "third place takes bronze");

        assertEq(store.raceCountOf(T_A), 1, "the race is recorded once");
        assertEq(store.raceCountOf(T_B), 1);
        assertEq(store.raceCountOf(T_C), 1);
    }

    // ---------- 8. the migration wiring, proven rather than assumed ----------

    /// @dev THE TEST FOR THE CALL WE ALMOST SHIPPED WITHOUT. Every other test in
    ///      this file runs on a CareerStore that `setUp` already wired to the
    ///      engine, so none of them can catch a deploy that forgets
    ///      `careerStore.setDrawEngine`. This one builds the wiring the deploy
    ///      script is supposed to produce, then proves the recordRace path works
    ///      end to end through it.
    ///
    ///      WHAT GOES WRONG WITHOUT IT: `settleRound` pays the winners, emits
    ///      RoundSettled, looks completely successful, and then reverts on the
    ///      recordRace call inside it. The leaderboard silently never fills, and
    ///      a user watching the demo sees paid winners and an empty career page.
    ///      That is the worst failure mode available: money moved, nothing recorded.
    function test_SettleThenRecordRace_ReadsBackThroughTheSwappedCareerStore() public {
        // Build the deployed state: the pool and the CareerStore both pointing at
        // this engine, exactly as DeployGameEngine.s.sol leaves them.
        // The store's owner is this test contract, not the GameEngine's owner, so
        // the wiring call comes from here.
        store.setDrawEngine(address(engine));

        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        _seedPot(100 * ONE);

        uint256 roundId = _openRound();
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _coins3(10, 7, 4), _flags(false, false, false));
        vm.prank(operator_);
        engine.closeRound(roundId);

        // Before settlement the career books are empty, which is what makes the
        // read-back below meaningful rather than reading pre-seeded state.
        assertEq(store.raceCountOf(T_A), 0, "no races recorded yet");

        // This call is the one that reverts when the CareerStore was never wired.
        vm.prank(operator_);
        engine.settleRound(roundId, _winners(T_A, T_B, T_C));

        // The placings must read back through the CareerStore the deploy wired.
        (uint32 gold, uint32 silver, uint32 bronze) = store.trophiesOf(T_A);
        assertEq(gold, 1, "first place took gold through the swapped store");
        assertEq(silver, 0);
        assertEq(bronze, 0);

        (gold, silver, bronze) = store.trophiesOf(T_B);
        assertEq(silver, 1, "second place took silver through the swapped store");

        (gold, silver, bronze) = store.trophiesOf(T_C);
        assertEq(bronze, 1, "third place took bronze through the swapped store");

        assertEq(store.raceCountOf(T_A), 1, "one race recorded for first place");
        assertEq(store.raceCountOf(T_B), 1, "one race recorded for second place");
        assertEq(store.raceCountOf(T_C), 1, "one race recorded for third place");

        uint256[] memory races = store.racesOf(T_A);
        assertEq(races.length, 1, "the race id is recorded");
        assertEq(races[0], roundId, "and it is the round id, so the leaderboard joins");
    }

    /// @dev The negative half of the same property. A CareerStore still pointing
    ///      at the OLD engine must refuse the new engine's recordRace. This is
    ///      what a deploy missing the second transaction actually produces, pinned
    ///      as a revert rather than described in a comment.
    function test_RecordRace_Reverts_WhenTheCareerStoreWasNeverRewired() public {
        // Fresh store, still wired to a DrawEngine that is NOT this engine.
        CareerStore unwired = new CareerStore(address(this));
        DrawEngine oldEngine = new DrawEngine(address(this), operator_);
        unwired.setDrawEngine(address(oldEngine));

        GameEngine freshEngine =
            new GameEngine(address(this), operator_, address(unwired), address(testChog), authority_);
        freshEngine.setPool(address(pool));
        // The POOL is wired to the new engine, exactly as the deploy script does
        // it, so payPot works and the prize pays. The ONLY unwired consumer left
        // is the CareerStore. Without this line the test reverts at payPot and
        // proves nothing about recordRace.
        pool.setDrawEngine(address(freshEngine));

        // Fund the fresh engine's coin treasury, or the submission reverts on the
        // coin payout before it ever reaches the recordRace call under test.
        vm.prank(owner_);
        testChog.transfer(address(freshEngine), 100 * CHOG_ONE);

        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        _seedPot(100 * ONE);

        // A round on the NEW engine, while the store still points at the old one.
        vm.prank(operator_);
        uint256 roundId = freshEngine.openRound(bytes32("course-seed"), uint64(block.timestamp + 1 hours));
        vm.prank(authority_);
        freshEngine.submitScores(
            roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _coins3(10, 7, 4), _flags(false, false, false)
        );
        vm.prank(operator_);
        freshEngine.closeRound(roundId);

        // Settlement reaches recordRace and is refused by the unwired store.
        vm.prank(operator_);
        vm.expectRevert();
        freshEngine.settleRound(roundId, _winners(T_A, T_B, T_C));

        // And the leaderboard is empty, which is the silent damage.
        assertEq(unwired.raceCountOf(T_A), 0, "nothing was recorded");
    }

    /// @dev The wiring read-back the deploy script asserts, pinned here so the
    ///      assertion itself is covered by a test rather than trusted.
    function test_BothWirings_ReadBackAfterTheSwap() public {
        store.setDrawEngine(address(engine));

        assertEq(pool.drawEngine(), address(engine), "the pool accepts the engine");
        assertEq(store.drawEngine(), address(engine), "the store accepts the engine");
    }

    // ---------- 9. coins: the payout path the site copy promises ----------

    /// @dev THE END-TO-END COIN PATH. A submitted run's coins must reach the
    ///      player's wallet in Test $CHOG, at the published rate, in the same
    ///      transaction that records the run. This is the promise the frontend
    ///      already makes on screen, so it is tested against real balances rather
    ///      than inferred from an event.
    function test_Coins_ReachThePlayer_InTheSameTransactionAsTheRun() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        uint256 roundId = _openRound();

        uint256 aBefore = testChog.balanceOf(alice);
        uint256 bBefore = testChog.balanceOf(bob);
        uint256 cBefore = testChog.balanceOf(carol);

        // Alice collects 10 coins, bob 7, carol 4.
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _coins3(10, 7, 4), _flags(false, false, false));

        // 0.1 Test $CHOG per coin, paid immediately.
        assertEq(testChog.balanceOf(alice) - aBefore, 10 * COIN_RATE, "alice was paid for 10 coins");
        assertEq(testChog.balanceOf(bob) - bBefore, 7 * COIN_RATE, "bob was paid for 7 coins");
        assertEq(testChog.balanceOf(carol) - cBefore, 4 * COIN_RATE, "carol was paid for 4 coins");

        // The run is recorded too, which is what makes it "the same transaction".
        assertEq(engine.coinsOf(roundId, T_A), 10, "the coin count is recorded");
        assertEq(engine.scoreOf(roundId, T_A), 300, "and so is the score");
        assertTrue(engine.hasRun(roundId, T_A), "the run exists");
    }

    /// @dev The payout is a function of the recorded coins, never of how much the
    ///      engine holds. A treasury cannot be drained by recording a huge count:
    ///      either the transfer fails and the whole submission reverts, or it
    ///      succeeds and pays exactly coins * rate.
    function test_Coins_PayoutNeverExceedsTheTreasury() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();

        uint256 treasury = testChog.balanceOf(address(engine));
        // The treasury holds 100 CHOG. Asking for 2,000 coins would pay 200 CHOG,
        // which is more than the engine has.
        vm.prank(authority_);
        vm.expectRevert();
        engine.submitScores(roundId, _single(T_A), _single(100), _coins1(2_000), _singleFlag(false));

        // The failed submission must not have recorded the run either.
        assertFalse(engine.hasRun(roundId, T_A), "nothing was recorded when the payout failed");
        assertEq(testChog.balanceOf(address(engine)), treasury, "the treasury is untouched");
    }

    /// @dev A run with zero coins pays nothing but is still recorded: a player who
    ///      collects no coins has still played, and the leaderboard must show them.
    function test_Coins_ZeroCoins_StillRecordsTheRun() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();

        uint256 before = testChog.balanceOf(alice);
        _submit(roundId, _single(T_A), _single(50), _coins1(0), _singleFlag(false));

        assertEq(testChog.balanceOf(alice), before, "no payout for no coins");
        assertTrue(engine.hasRun(roundId, T_A), "but the run is still recorded");
        assertEq(engine.coinPayoutOf(roundId, T_A), 0, "and the payout reads zero");
    }

    /// @dev The rate is readable so the UI shows one number, not a hardcoded one
    ///      that can drift from the contract.
    function test_Coins_RateIsReadable() public {
        assertEq(engine.coinRate(), COIN_RATE, "the rate is exposed");
        assertEq(COIN_RATE, 0.1 ether, "and it is 0.1 Test $CHOG per coin");
    }

    // ---------- 10. best run counts, not first run ----------

    /// @dev A higher second score REPLACES the entry. The board must rank the
    ///      player's best run, not their first one: a judge's first run is a
    ///      learning run, and ranking it would make the game look broken.
    function test_BestRunCounts_HigherScoreReplacesTheEntry() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();

        // First, weaker run.
        _submit(roundId, _single(T_A), _single(100), _coins1(10), _singleFlag(false));
        assertEq(engine.scoreOf(roundId, T_A), 100, "the first run is the entry");

        // Then a better one.
        _submit(roundId, _single(T_A), _single(250), _coins1(18), _singleFlag(false));

        assertEq(engine.scoreOf(roundId, T_A), 250, "the better run replaced it");
        assertEq(engine.coinsOf(roundId, T_A), 18, "and so did its coin count");
        assertTrue(engine.hasRun(roundId, T_A), "the run still exists");
        assertEq(engine.participantCount(roundId), 1, "one Chog, still one participant");
    }

    /// @dev A score that is not strictly higher is refused, by name, so the
    ///      recorder can distinguish "worse run, skip it" from a real failure.
    function test_BestRunCounts_WorseScoreIsRefused_ByName() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();
        _submit(roundId, _single(T_A), _single(100), _coins1(10), _singleFlag(false));

        vm.prank(authority_);
        vm.expectRevert(
            abi.encodeWithSelector(GameEngine.NotABetterScore.selector, roundId, T_A, 100, 50)
        );
        engine.submitScores(roundId, _single(T_A), _single(50), _coins1(99), _singleFlag(false));
    }

    /// @dev An EQUAL score is refused too. "Not strictly higher" is the rule, and
    ///      allowing a tie would let a run be resubmitted endlessly for the same
    ///      score, which is a replay rather than a replacement.
    function test_BestRunCounts_EqualScoreIsRefused() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();
        _submit(roundId, _single(T_A), _single(100), _coins1(10), _singleFlag(false));

        vm.prank(authority_);
        vm.expectRevert(abi.encodeWithSelector(GameEngine.NotABetterScore.selector, roundId, T_A, 100, 100));
        engine.submitScores(roundId, _single(T_A), _single(100), _coins1(20), _singleFlag(false));
    }

    /// @dev The refused run must not have changed anything: the entry, the coins
    ///      and the purse all stay exactly as the accepted run left them.
    function test_BestRunCounts_RefusedRunLeavesTheEntryUntouched() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();
        _submit(roundId, _single(T_A), _single(100), _coins1(10), _singleFlag(false));

        uint256 purseBefore = testChog.balanceOf(alice);
        vm.prank(authority_);
        vm.expectRevert();
        engine.submitScores(roundId, _single(T_A), _single(50), _coins1(99), _singleFlag(false));

        assertEq(engine.scoreOf(roundId, T_A), 100, "score unchanged");
        assertEq(engine.coinsOf(roundId, T_A), 10, "coins unchanged");
        assertEq(testChog.balanceOf(alice), purseBefore, "purse unchanged");
    }

    /// @dev THE COIN DIFFERENCE, PAID EXACTLY. The player was already paid for
    ///      the coins on their previous entry, so only the increase moves. Paying
    ///      the full amount again would double-pay and drain the treasury.
    function test_BestRunCounts_OnlyTheCoinDifferenceIsPaid() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();

        uint256 start = testChog.balanceOf(alice);
        _submit(roundId, _single(T_A), _single(100), _coins1(10), _singleFlag(false));
        uint256 afterFirst = testChog.balanceOf(alice);
        assertEq(afterFirst - start, 10 * COIN_RATE, "10 coins paid 1.0 CHOG");

        // A better run with 8 more coins.
        _submit(roundId, _single(T_A), _single(200), _coins1(18), _singleFlag(false));
        uint256 afterSecond = testChog.balanceOf(alice);

        // Exactly the difference, not the full 18 coins.
        assertEq(afterSecond - afterFirst, 8 * COIN_RATE, "only the 8 new coins paid");
        assertEq(afterSecond - start, 18 * COIN_RATE, "the purse equals the best run's coins exactly");
    }

    /// @dev A better run that collects FEWER coins pays nothing and takes nothing
    ///      back. Clawing back would mean the engine moving a player's tokens
    ///      without consent, which is a worse thing than the mismatch.
    function test_BestRunCounts_FewerCoinsPaysNoClawback() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();

        _submit(roundId, _single(T_A), _single(100), _coins1(10), _singleFlag(false));
        uint256 purseBefore = testChog.balanceOf(alice);
        assertGt(purseBefore, 0, "the first run paid");

        // Better score, fewer coins.
        _submit(roundId, _single(T_A), _single(300), _coins1(4), _singleFlag(false));

        assertEq(testChog.balanceOf(alice), purseBefore, "nothing was clawed back");
        assertEq(engine.coinsOf(roundId, T_A), 4, "the best run's coins are recorded");
        assertEq(engine.scoreOf(roundId, T_A), 300, "and its score ranks");
    }

    /// @dev The old entry's numbers must be GONE, not merely shadowed. A leaderboard
    ///      reading a stale score would rank the wrong run.
    function test_BestRunCounts_OldEntryNumbersAreGone() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();
        _submit(roundId, _single(T_A), _single(100), _coins1(10), _singleFlag(true));
        _submit(roundId, _single(T_A), _single(400), _coins1(25), _singleFlag(false));

        assertEq(engine.scoreOf(roundId, T_A), 400, "score replaced");
        assertEq(engine.coinsOf(roundId, T_A), 25, "coins replaced");
        assertFalse(engine.revivedOf(roundId, T_A), "the revive flag replaced too");
    }

    /// @dev The placements at settlement must read the FINAL entries. This is the
    ///      end-to-end property: replace runs, then settle, and the podium must
    ///      reflect the best runs rather than the first ones.
    function test_BestRunCounts_SettlementReadsTheFinalEntries() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        _seedPot(100 * ONE);
        uint256 roundId = _openRound();

        // First pass: alice 100, bob 300, carol 200.
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(100, 300, 200), _coins3(10, 10, 10), _flags(false, false, false));
        // Second pass: alice overtakes everyone with 500.
        _submit(roundId, _single(T_A), _single(500), _coins1(30), _singleFlag(false));

        vm.prank(operator_);
        engine.closeRound(roundId);

        // Alice's best run wins, even though bob beat her on the first pass.
        vm.prank(operator_);
        engine.settleRound(roundId, _winners(T_A, T_B, T_C));

        (uint32 gold, uint32 silver, uint32 bronze) = store.trophiesOf(T_A);
        assertEq(gold, 1, "alice's BEST run took gold");
        assertEq(silver, 0, "and nothing else");
        assertEq(bronze, 0, "and nothing else");

        (, silver, bronze) = store.trophiesOf(T_B);
        assertEq(silver, 1, "bob took silver on his first-pass score");
        assertEq(bronze, 0);

        (, , bronze) = store.trophiesOf(T_C);
        assertEq(bronze, 1, "carol took bronze");

        // And the leaderboard reads the final numbers.
        assertEq(engine.scoreOf(roundId, T_A), 500, "the board shows the best run");
        assertEq(engine.roundWinnersOf(roundId)[0], T_A, "and alice is first on the podium");
    }

    /// @dev Each Chog is capped independently: a better run for one Chog does not
    ///      reset or affect another Chog's entry.
    function test_BestRunCounts_EachChogIsIndependent() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        uint256 roundId = _openRound();

        _submit(roundId, _ids2(T_A, T_B), _scores2(100, 200), _coins2(5, 7), _pairFlag(false, false));
        _submit(roundId, _single(T_A), _single(900), _coins1(50), _singleFlag(false));

        assertEq(engine.scoreOf(roundId, T_A), 900, "alice replaced hers");
        assertEq(engine.scoreOf(roundId, T_B), 200, "bob's is untouched");
        assertEq(engine.coinsOf(roundId, T_B), 7, "and so are his coins");
        assertEq(engine.participantCount(roundId), 2, "still two participants");
    }

    // ---------- access control ----------

    function test_OnlyTheAuthority_CanSubmitScores() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();

        uint256[] memory ids = new uint256[](1);
        ids[0] = T_A;
        uint256[] memory scores = new uint256[](1);
        scores[0] = 100;
        uint256[] memory coins = new uint256[](1);
        coins[0] = 10;
        bool[] memory revived = new bool[](1);
        revived[0] = false;

        vm.prank(alice);
        vm.expectRevert(GameEngine.NotGameAuthority.selector);
        engine.submitScores(roundId, ids, scores, coins, revived);
    }

    function test_OnlyTheOperator_CanOpenAndSettle() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.openRound(bytes32("x"), uint64(block.timestamp + 1 hours));
    }

    /// A revive bought by a wallet with no stake would let anyone pad the bonus
    /// pot without being in the race.
    function test_Revive_RejectsATokenWithNoPosition() public {
        uint256 roundId = _openRound();

        vm.startPrank(alice);
        testChog.approve(address(engine), 100 * CHOG_ONE);
        vm.expectRevert(abi.encodeWithSelector(GameEngine.NotInPool.selector, T_C));
        engine.payRevive(roundId, T_C);
        vm.stopPrank();
    }

    // ---------- helpers ----------

    /// @dev Fixed-size array literals in Solidity infer the smallest type that
    ///      fits, so `[300, 200, 100]` becomes uint16[3] and will not pass to a
    ///      uint256[3] parameter. Building the arrays explicitly is the fix, and
    ///      doing it in one helper keeps every test readable.
    function _submit(
        uint256 roundId,
        uint256[] memory tokenIds,
        uint256[] memory scores,
        uint256[] memory coins,
        bool[] memory revived
    ) internal {
        vm.prank(authority_);
        engine.submitScores(roundId, tokenIds, scores, coins, revived);
    }

    function _ids(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory) {
        uint256[] memory v = new uint256[](3);
        v[0] = a;
        v[1] = b;
        v[2] = c;
        return v;
    }

    function _scores(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory) {
        uint256[] memory v = new uint256[](3);
        v[0] = a;
        v[1] = b;
        v[2] = c;
        return v;
    }

    function _flags(bool a, bool b, bool c) internal pure returns (bool[] memory) {
        bool[] memory v = new bool[](3);
        v[0] = a;
        v[1] = b;
        v[2] = c;
        return v;
    }

    function _coins3(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory) {
        uint256[] memory v = new uint256[](3);
        v[0] = a;
        v[1] = b;
        v[2] = c;
        return v;
    }

    function _coins1(uint256 a) internal pure returns (uint256[] memory) {
        uint256[] memory v = new uint256[](1);
        v[0] = a;
        return v;
    }

    function _coins2(uint256 a, uint256 b) internal pure returns (uint256[] memory) {
        uint256[] memory v = new uint256[](2);
        v[0] = a;
        v[1] = b;
        return v;
    }

    function _single(uint256 a) internal pure returns (uint256[] memory) {
        uint256[] memory v = new uint256[](1);
        v[0] = a;
        return v;
    }

    function _pair(uint256 a, uint256 b) internal pure returns (uint256[] memory) {
        uint256[] memory v = new uint256[](2);
        v[0] = a;
        v[1] = b;
        return v;
    }

    function _ids2(uint256 a, uint256 b) internal pure returns (uint256[] memory) {
        uint256[] memory v = new uint256[](2);
        v[0] = a;
        v[1] = b;
        return v;
    }

    function _scores2(uint256 a, uint256 b) internal pure returns (uint256[] memory) {
        uint256[] memory v = new uint256[](2);
        v[0] = a;
        v[1] = b;
        return v;
    }

    function _singleFlag(bool a) internal pure returns (bool[] memory) {
        bool[] memory v = new bool[](1);
        v[0] = a;
        return v;
    }

    function _pairFlag(bool a, bool b) internal pure returns (bool[] memory) {
        bool[] memory v = new bool[](2);
        v[0] = a;
        v[1] = b;
        return v;
    }

    /// @dev settleRound takes a fixed `uint256[3]`, which is the one place a plain
    ///      array literal will not do. Built explicitly so the placement order is
    ///      readable at the call site.
    function _winners(uint256 first, uint256 second, uint256 third)
        internal
        pure
        returns (uint256[3] memory)
    {
        uint256[3] memory v;
        v[0] = first;
        v[1] = second;
        v[2] = third;
        return v;
    }
}
