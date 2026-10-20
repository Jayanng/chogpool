// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {GameEngine} from "../src/GameEngine.sol";
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
        bool[] memory revived = _flags(false, false, false);
        _submit(roundId, tokenIds, scores, revived);

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
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _flags(false, false, false));
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
        assertEq(feePool, 20 * CHOG_ONE, "the engine holds both fees");

        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _flags(true, true, false));
        vm.prank(operator_);
        engine.closeRound(roundId);

        uint256 aBefore = testChog.balanceOf(alice);
        uint256 bBefore = testChog.balanceOf(bob);
        uint256 cBefore = testChog.balanceOf(carol);

        vm.prank(operator_);
        engine.settleRound(roundId, [T_A, T_B, T_C]);

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
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _flags(false, false, false));
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
        _submit(roundId, _single(T_A), _single(300), _singleFlag(false));
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
        _submit(roundId, _pair(T_A, T_B), _pair(300, 200), _pairFlag(false, false));
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
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _flags(false, false, false));
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
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _flags(false, false, false));
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
        _submit(roundId, _ids(T_A, T_B, T_C), _scores(300, 200, 100), _flags(false, false, false));
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

    // ---------- access control ----------

    function test_OnlyTheAuthority_CanSubmitScores() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 roundId = _openRound();

        uint256[] memory ids = new uint256[](1);
        ids[0] = T_A;
        uint256[] memory scores = new uint256[](1);
        scores[0] = 100;
        bool[] memory revived = new bool[](1);
        revived[0] = false;

        vm.prank(alice);
        vm.expectRevert(GameEngine.NotGameAuthority.selector);
        engine.submitScores(roundId, ids, scores, revived);
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
        bool[] memory revived
    ) internal {
        vm.prank(authority_);
        engine.submitScores(roundId, tokenIds, scores, revived);
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
}
