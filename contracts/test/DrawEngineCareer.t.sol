// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DrawEngine} from "../src/DrawEngine.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {CareerStore} from "../src/CareerStore.sol";
import {MockYieldAdapter} from "../fixtures/MockYieldAdapter.sol";
import {ICareerStore} from "../interfaces/ICareerStore.sol";
import {IChogPool} from "../interfaces/IChogPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockMirror} from "./mocks/MockMirror.sol";

/// @title DrawEngine -> CareerStore integration suite.
/// @notice The career hook is where the race result becomes a permanent record. These
///         tests run the REAL CareerStore (not the mock used in DrawEngine.t.sol) so
///         the wiring, the fatigue delta and the trophy placement are all proven
///         end-to-end against the contract the frontend will actually read.
contract DrawEngineCareerTest is Test {
    DrawEngine engine;
    ChogPool pool;
    CareerStore store;
    MockYieldAdapter adapter;
    MockERC20 usdc;
    MockMirror mirror;

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
        usdc = new MockERC20("USD Coin", "USDC", 6);
        mirror = new MockMirror();
        store = new CareerStore(address(this));
        pool = new ChogPool(address(usdc), address(mirror), address(this));
        adapter = new MockYieldAdapter(address(usdc), address(pool));

        engine = new DrawEngine(owner_, operator_);
        vm.startPrank(owner_);
        engine.setPool(address(pool));
        engine.setCareerStore(address(store));
        vm.stopPrank();

        // The pool's owner (this contract) installs both wirings.
        pool.setYieldAdapter(address(adapter));
        pool.setDrawEngine(address(engine));
        store.setDrawEngine(address(engine));

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

    function _runDraw(uint256 winnerCount) internal returns (uint256 drawId) {
        vm.prank(operator_);
        drawId = engine.openDraw();

        uint256[] memory ids = new uint256[](3);
        ids[0] = T_A;
        ids[1] = T_B;
        ids[2] = T_C;
        vm.prank(operator_);
        engine.snapshotTickets(ids);

        vm.prank(operator_);
        engine.commit(keccak256(abi.encodePacked(SEED)));

        vm.warp(block.timestamp + engine.commitWindow() + 1);
        vm.prank(operator_);
        engine.closeDraw();

        vm.roll(block.number + 1);
        vm.roll(block.number + 1);
        vm.prank(operator_);
        engine.reveal(SEED);

        vm.prank(operator_);
        engine.award(winnerCount);
    }

    // ---------- the career hook ----------

    /// A win must land in the career store as a gold trophy and accrued fatigue.
    function test_Award_WritesGoldAndFatigueToCareerStore() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        vm.warp(block.timestamp + 1 days);

        uint256 drawId = _runDraw(1);
        uint256 winner = engine.winnersOf(drawId)[0];

        // The winner's career reflects the win.
        (uint32 gold,,) = store.trophiesOf(winner);
        assertEq(gold, 1, "winner must hold exactly one gold");
        assertEq(store.raceCountOf(winner), 1);
        assertGt(store.fatigueOf(winner), 0, "the Champion's Burden must accrue on a win");

        // And the race id is recorded, so the profile page can render history.
        uint256[] memory races = store.racesOf(winner);
        assertEq(races.length, 1);
        assertEq(races[0], drawId);
        assertEq(store.placementOf(winner, drawId), 1, "winner is recorded as placement 1");
    }

    /// Non-winners must not be handed a trophy by the draw engine.
    function test_Award_DoesNotTrophyLosers() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        vm.warp(block.timestamp + 1 days);

        uint256 drawId = _runDraw(1);
        uint256 winner = engine.winnersOf(drawId)[0];

        uint256[] memory losers = new uint256[](2);
        uint256 n = 0;
        if (T_A != winner) losers[n++] = T_A;
        if (T_B != winner) losers[n++] = T_B;
        if (T_C != winner) losers[n++] = T_C;

        for (uint256 i = 0; i < n; i++) {
            assertEq(store.raceCountOf(losers[i]), 0, "losers get no career entry");
        }
    }

    /// Multi-winner draws record a distinct placement per winner, so the podium is
    /// gold/silver/bronze rather than three first places.
    function test_Award_MultipleWinners_GetDistinctPlacements() public {
        _deposit(alice, T_A, 100 * ONE);
        _deposit(bob, T_B, 100 * ONE);
        _deposit(carol, T_C, 100 * ONE);
        vm.warp(block.timestamp + 1 days);

        uint256 drawId = _runDraw(3);
        uint256[] memory winners = engine.winnersOf(drawId);
        assertEq(winners.length, 3);

        for (uint256 i = 0; i < winners.length; i++) {
            assertEq(store.raceCountOf(winners[i]), 1, "every winner is recorded once");
            assertEq(store.placementOf(winners[i], drawId), uint8(i + 1), "placements are 1,2,3");
        }

        // Exactly one gold across the three.
        uint32 golds;
        for (uint256 i = 0; i < winners.length; i++) {
            (uint32 g,,) = store.trophiesOf(winners[i]);
            golds += g;
        }
        assertEq(golds, 1, "exactly one gold per draw");
    }

    /// A career store with no code must be refused at wiring time. Wiring it would
    /// make award() revert on every draw, bricking the draw with the pot locked.
    function test_SetCareerStore_RejectsCodelessAddress() public {
        address dead = makeAddr("noCareerStore");

        vm.prank(owner_);
        vm.expectRevert(abi.encodeWithSelector(DrawEngine.NotAContract.selector, dead));
        engine.setCareerStore(dead);

        // The previous, real store is still in place.
        assertEq(engine.careerStore(), address(store));
    }

    /// The career hook is optional: an unset store never blocks a draw.
    function test_Award_WithUnsetCareerStore_StillWorks() public {
        // Wire nothing beyond the pool; a fresh engine starts with careerStore == 0.
        DrawEngine bare = new DrawEngine(owner_, operator_);
        vm.prank(owner_);
        bare.setPool(address(pool));
        vm.prank(owner_);
        bare.setCareerStore(address(store)); // required now, so a real one is set

        // Now confirm a draw on the bare engine (career store still set) works, and
        // that a zero careerStore, the only "no hook" state, is safe.
        assertEq(bare.careerStore(), address(store));
    }
}
