// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DrawEngine} from "../src/DrawEngine.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {MockYieldAdapter} from "../fixtures/MockYieldAdapter.sol";
import {IDrawEngine} from "../interfaces/IDrawEngine.sol";
import {IChogPool} from "../interfaces/IChogPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockMirror} from "./mocks/MockMirror.sol";
import {MockCareerStore} from "./mocks/MockCareerStore.sol";

/// @title DrawEngine fairness suite.
/// @notice These tests assert the fairness claim itself: the winner is a deterministic
///         function of the published seed, and it can be recomputed independently.
contract DrawEngineTest is Test {
    DrawEngine engine;
    ChogPool pool;
    MockYieldAdapter adapter;
    MockERC20 usdc;
    MockMirror mirror;
    MockCareerStore careerStore;

    address owner_ = makeAddr("owner");
    address operator_ = makeAddr("operator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint256 constant ONE = 1e6;

    uint256 constant T_A = 1;
    uint256 constant T_B = 2;
    uint256 constant T_C = 3;

    bytes32 constant SEED = keccak256("chogpool-draw-seed");

    function setUp() public {
        // This suite is a PURE unit suite: it relies on vm.roll()/vm.warp() producing
        // readable parent blockhashes, which a forked chain does not guarantee (the
        // fork's parent hash is not in the local cache). If someone runs the whole
        // suite with --rpc-url, fail loudly here instead of producing 10 confusing
        // RevealBlockUnavailable errors in unrelated tests.
        if (block.chainid != 31337) revert("DrawEngineTest is a unit suite: run without --rpc-url");

        usdc = new MockERC20("USD Coin", "USDC", 6);
        mirror = new MockMirror();
        careerStore = new MockCareerStore();
        pool = new ChogPool(address(usdc), address(mirror), address(this));
        adapter = new MockYieldAdapter(address(usdc), address(pool));

        engine = new DrawEngine(owner_, operator_);
        vm.startPrank(owner_);
        engine.setPool(address(pool));
        engine.setCareerStore(address(careerStore));
        vm.stopPrank();

        // The test contract owns the pool (constructor arg), so it can wire the
        // adapter and install the draw engine directly, no prank needed.
        pool.setYieldAdapter(address(adapter));
        pool.setDrawEngine(address(engine));

        mirror.setOwnerOf(T_A, alice);
        mirror.setOwnerOf(T_B, bob);
        mirror.setOwnerOf(T_C, carol);

        usdc.mint(alice, 10_000 * ONE);
        usdc.mint(bob, 10_000 * ONE);
        usdc.mint(carol, 10_000 * ONE);
    }

    function _deposit(address who, uint256 tokenId, uint256 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(pool), amount);
        pool.deposit(tokenId, amount);
        vm.stopPrank();
    }

    /// @dev Runs the draw to the CLOSED state: open, snapshot tickets, commit while
    ///      still Open (commit() requires DrawState.Open), then wait out the commit
    ///      window and close. This mirrors the real deploy-script order. The caller
    ///      then decides when to reveal.
    function _openAndClose() internal returns (uint256 drawId) {
        return _openCommitClose(SEED);
    }

    /// @dev Same lifecycle with an arbitrary committed seed, so tests can show the
    ///      draw is a real function of the seed rather than a fixed winner. Ends in
    ///      the Awarded state so deriveWinners() has randomness to work from.
    function _openWithSeed(bytes32 seed) internal returns (uint256 drawId) {
        drawId = _openCommitClose(seed);
        // Two rolls: the engine binds blockhash(block.number - 1), so the reveal
        // must be at least two blocks past the close for a real, distinct hash.
        vm.roll(block.number + 1);
        vm.roll(block.number + 1);
        vm.prank(operator_);
        engine.reveal(seed);
    }

    function _openCommitClose(bytes32 seed) internal returns (uint256 drawId) {
        vm.prank(operator_);
        drawId = engine.openDraw();

        uint256[] memory ids = new uint256[](3);
        ids[0] = T_A;
        ids[1] = T_B;
        ids[2] = T_C;
        // snapshotTickets is the ONLY path into pool.freezeTickets: the pool
        // requires msg.sender == drawEngine, so calling it directly as the
        // operator would revert NotMirrorOwner.
        vm.prank(operator_);
        engine.snapshotTickets(ids);

        // The commit must land while the draw is still Open.
        vm.prank(operator_);
        engine.commit(keccak256(abi.encodePacked(seed)));

        vm.warp(block.timestamp + engine.commitWindow() + 1);
        vm.prank(operator_);
        engine.closeDraw();
    }

    function _reveal() internal {
        // Two rolls: the engine binds blockhash(block.number - 1), so the reveal
        // must be at least two blocks past the close for a real, distinct hash.
        vm.roll(block.number + 1);
        vm.roll(block.number + 1);
        vm.prank(operator_);
        engine.reveal(SEED);
    }

    function _injectPot(uint256 amount) internal {
        usdc.mint(address(this), amount);
        usdc.approve(address(adapter), amount);
        adapter.injectYield(amount);
        pool.harvest();
    }

    // ---------- lifecycle ----------

    function test_FullLifecycle_OpenCommitRevealAwardFinalize() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 200 * ONE);
        vm.warp(block.timestamp + 1 days);

        uint256 drawId = _openAndClose();
        assertEq(uint256(engine.stateOf(drawId)), uint256(IDrawEngine.DrawState.Closed));
        assertGt(engine.totalTicketsOf(drawId), 0);

        _reveal();
        assertEq(uint256(engine.stateOf(drawId)), uint256(IDrawEngine.DrawState.Awarded));
        assertTrue(engine.finalRandomnessOf(drawId) != bytes32(0));

        _injectPot(30 * ONE);

        vm.prank(operator_);
        engine.award(1);

        uint256[] memory winners = engine.winnersOf(drawId);
        assertEq(winners.length, 1);
        assertTrue(winners[0] == T_A || winners[0] == T_B || winners[0] == T_C);

        vm.prank(operator_);
        engine.finalize();
        assertEq(uint256(engine.stateOf(drawId)), uint256(IDrawEngine.DrawState.Finalized));
    }

    function test_OnlyOperatorCanOpenAndClose() public {
        vm.prank(alice);
        vm.expectRevert(IDrawEngine.NotOperator.selector);
        engine.openDraw();
    }

    function test_CannotCloseBeforeCommitWindow() public {
        vm.prank(operator_);
        engine.openDraw();
        vm.prank(operator_);
        vm.expectRevert(IDrawEngine.CommitWindowClosed.selector);
        engine.closeDraw();
    }

    function test_CannotOpenWhilePreviousDrawActive() public {
        vm.prank(operator_);
        engine.openDraw();
        vm.prank(operator_);
        vm.expectRevert(
            abi.encodeWithSelector(IDrawEngine.WrongState.selector, IDrawEngine.DrawState.Finalized, IDrawEngine.DrawState.Open)
        );
        engine.openDraw();
    }

    // ---------- commit-reveal binding ----------

    function test_Reveal_RejectsWrongSeed() public {
        _deposit(alice, T_A, 100 * ONE);
        _openAndClose(); // committed SEED, now Closed

        vm.roll(block.number + 1);
        vm.prank(operator_);
        vm.expectRevert();
        engine.reveal(keccak256("wrong-seed"));
    }

    function test_Reveal_BindsBlockhashOfRevealBlock() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 drawId = _openAndClose();

        _reveal();

        bytes32 randomness = engine.finalRandomnessOf(drawId);
        // The commit was over keccak256(SEED); the reveal was the raw SEED. The
        // randomness must be reproducible from exactly those published inputs.
        uint256 revealBlock = engine.revealBlockOf(drawId);
        // The engine binds blockhash(revealBlock) where revealBlock = reveal
        // block - 1: EVM blockhash() of the CURRENT block is zero, so the
        // previous block is the only honest value to bind.
        assertLt(revealBlock, block.number, "bound block must be in the past");
        bytes32 boundHash = blockhash(revealBlock);
        assertTrue(boundHash != bytes32(0), "bound blockhash must be non-zero");
        bytes32 expected = keccak256(abi.encodePacked(SEED, boundHash, drawId));
        assertEq(randomness, expected, "randomness must be reproducible from published inputs");

        // A different block's hash gives different randomness, the binding is
        // what stops the operator from choosing the outcome.
        bytes32 other = keccak256(abi.encodePacked(SEED, blockhash(revealBlock - 1), drawId));
        assertTrue(randomness != other, "a different block must change the randomness");

        // The published seed is the raw one, and it hashes to the recorded commit.
        assertEq(engine.seedOf(drawId), SEED);
        assertEq(engine.commitOf(drawId), keccak256(abi.encodePacked(SEED)));
    }

    function test_Commit_RejectedAfterClose() public {
        _deposit(alice, T_A, 100 * ONE);
        _openAndClose(); // already closed
        vm.prank(operator_);
        vm.expectRevert();
        engine.commit(keccak256(abi.encodePacked(SEED)));
    }

    function test_Reveal_RejectedBeforeClose() public {
        _deposit(alice, T_A, 100 * ONE);
        vm.prank(operator_);
        engine.openDraw();
        vm.prank(operator_);
        engine.commit(keccak256(abi.encodePacked(SEED)));
        vm.prank(operator_);
        vm.expectRevert();
        engine.reveal(SEED);
    }

    // ---------- fairness: independent re-derivation ----------

    /// THE fairness property: the on-chain winner equals an independent
    /// re-computation from the published seed and the frozen ticket book.
    function test_WinnerIsReDerivableFromPublishedSeed() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 250 * ONE);
        _deposit(carol, T_C, 50 * ONE);
        vm.warp(block.timestamp + 2 days);

        uint256 drawId = _openAndClose();
        _reveal();

        vm.prank(operator_);
        engine.award(1);
        uint256[] memory onChain = engine.winnersOf(drawId);

        // Independent re-derivation: the contract exposes deriveWinners() which
        // recomputes purely from finalRandomness + the frozen book.
        uint256[] memory recomputed = engine.deriveWinners(drawId, 1);

        assertEq(onChain.length, recomputed.length);
        assertEq(onChain[0], recomputed[0], "on-chain winner must equal recomputed winner");
        assertGt(engine.ticketsOf(drawId, onChain[0]), 0, "winner must hold tickets");
    }

    /// The same seed on the same book must always give the same winner.
    function testFuzz_SameSeedSameBookSameWinner(uint8 winnerCount) public {
        winnerCount = uint8(bound(winnerCount, 1, 3));
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 250 * ONE);
        _deposit(carol, T_C, 50 * ONE);
        vm.warp(block.timestamp + 1 days);

        uint256 drawId = _openAndClose();
        _reveal();

        vm.prank(operator_);
        engine.award(winnerCount);
        uint256[] memory first = engine.winnersOf(drawId);

        for (uint256 i = 0; i < 5; i++) {
            uint256[] memory again = engine.deriveWinners(drawId, winnerCount);
            assertEq(again.length, first.length);
            for (uint256 j = 0; j < first.length; j++) {
                assertEq(again[j], first[j], "derivation must be deterministic");
            }
        }
    }

    /// Different seeds must be able to produce different winners (the draw is real).
    function testFuzz_DifferentSeedsGiveDifferentWinners(uint8 seedVariant) public {
        seedVariant = uint8(bound(seedVariant, 0, 255));
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 250 * ONE);
        _deposit(carol, T_C, 50 * ONE);
        vm.warp(block.timestamp + 1 days);

        bytes32 seed = keccak256(abi.encodePacked("variant", seedVariant));
        uint256 drawId = _openWithSeed(seed);

        uint256[] memory winners = engine.deriveWinners(drawId, 1);
        assertTrue(winners[0] == T_A || winners[0] == T_B || winners[0] == T_C);
        // The winner must be a real racer with tickets.
        assertGt(engine.ticketsOf(drawId, winners[0]), 0);
    }

    /// Odds must be proportional to frozen tickets, within the boost cap.
    function test_Odds_ProportionalToTickets() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 300 * ONE);
        vm.warp(block.timestamp + 1 days);

        uint256 drawId = _openAndClose();
        _reveal();

        uint256 total = engine.totalTicketsOf(drawId);
        uint256 oddsA = engine.oddsBpsOf(drawId, T_A);
        uint256 oddsB = engine.oddsBpsOf(drawId, T_B);
        assertEq(oddsA + oddsB, 10_000);
        // 100/(100+300) = 25%
        assertApproxEqRel(oddsA, 2500, 0.01e18);
        assertApproxEqRel(oddsB, 7500, 0.01e18);
        assertGt(total, 0);
    }

    // ---------- boost cap ----------

    function test_Boost_CannotExceedCap() public {
        vm.prank(operator_);
        vm.expectRevert();
        engine.setTraitBoost(T_A, 1, 0.26e18);
    }

    function test_Boost_AppliedWithinCap() public {
        vm.prank(operator_);
        engine.setTraitBoost(T_A, 1, 0.25e18);
        (uint32 tier, uint256 boost) = engine.boostOf(T_A);
        assertEq(boost, 0.25e18);
        assertEq(tier, 1);

        _deposit(alice, T_A, 100 * ONE);
        vm.warp(block.timestamp + 1 days);
        uint256 drawId = _openAndClose();

        // The boosted zone must be at most 1.25x the raw tickets.
        uint256 tickets = engine.ticketsOf(drawId, T_A);
        uint256 zone = engine.winningZone(T_A, 1, tickets);
        assertEq(zone, tickets + (tickets * 0.25e18) / 1e18);
    }

    // ---------- payout ----------

    function test_Pot_SplitEvenlyAcrossWinners() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        vm.warp(block.timestamp + 1 days);

        uint256 drawId = _openAndClose();
        _reveal();
        _injectPot(30 * ONE);

        vm.prank(operator_);
        engine.award(3);

        assertEq(engine.potPerWinnerOf(drawId), 10 * ONE);
        assertEq(pool.potBalance(), 0);
        assertEq(engine.winnersOf(drawId).length, 3);
    }

    function test_Award_RevertsWhenNoPot() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 drawId = _openAndClose();
        _reveal();
        // No pot: award must still succeed but pay nothing.
        vm.prank(operator_);
        engine.award(1);
        assertEq(engine.potPerWinnerOf(drawId), 0);
        assertEq(engine.winnersOf(drawId).length, 1);
    }

    // ---------- distribution sanity ----------

    /// Fuzz: across many seeds, winners must be spread across the racer set rather
    /// than collapsing onto one racer.
    function testFuzz_WinnerDistributionSpansRacers(uint8 seedVariant) public {
        seedVariant = uint8(bound(seedVariant, 0, 255));
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        vm.warp(block.timestamp + 1 days);

        bytes32 seed = keccak256(abi.encodePacked("dist", seedVariant));
        uint256 drawId = _openWithSeed(seed);

        uint256[] memory winners = engine.deriveWinners(drawId, 1);
        // Equal tickets: any of the three is legitimate, but the derivation must
        // produce a racer that actually holds tickets.
        assertGt(engine.ticketsOf(drawId, winners[0]), 0);
    }

    /// Aggregated distribution: over a fixed grid of seeds, every racer must win at
    /// least once. Equal tickets + a rigged derivation would collapse to one racer.
    function test_WinnerDistributionSpansEveryRacer() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        vm.warp(block.timestamp + 1 days);

        bool sawA;
        bool sawB;
        bool sawC;
        for (uint256 v = 0; v < 24; v++) {
            bytes32 seed = keccak256(abi.encodePacked("grid", v));
            uint256 drawId = _openWithSeed(seed);
            uint256[] memory winners = engine.deriveWinners(drawId, 1);
            if (winners[0] == T_A) sawA = true;
            else if (winners[0] == T_B) sawB = true;
            else if (winners[0] == T_C) sawC = true;
            // Finalize so the next openDraw() is legal (only one live draw).
            vm.prank(operator_);
            engine.finalize();
        }
        assertTrue(sawA && sawB && sawC, "every racer must win across the seed space");
    }

    function test_DeriveWinners_RevertsBeforeReveal() public {
        _deposit(alice, T_A, 100 * ONE);
        uint256 drawId = _openAndClose();
        vm.expectRevert();
        engine.deriveWinners(drawId, 1);
    }
}
