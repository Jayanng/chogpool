// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {MockYieldAdapter} from "../fixtures/MockYieldAdapter.sol";
import {ChogMirror} from "../src/ChogMirror.sol";
import {IChogPool} from "../interfaces/IChogPool.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockMirror} from "./mocks/MockMirror.sol";

/// @title TWAB invariant suite — the odds math is the fairness claim.
/// @notice If these tests are green, the "no last-second sniping" claim holds. If any
///         of them breaks, the fairness argument in the submission is a lie.
contract ChogPoolTwabTest is Test {
    ChogPool pool;
    MockYieldAdapter adapter;
    MockERC20 usdc;
    MockMirror mirror;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address treasury = makeAddr("treasury");

    uint256 constant TOKEN_A = 1; // alice
    uint256 constant TOKEN_B = 2; // bob
    uint256 constant TOKEN_C = 3; // carol

    uint256 constant ONE = 1e6; // 1 USDC (6 decimals)

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        mirror = new MockMirror();
        // The test contract owns the pool so it can wire adapters and act as the
        // draw engine (which pays the pot).
        pool = new ChogPool(address(usdc), address(mirror), address(this));
        adapter = new MockYieldAdapter(address(usdc), address(pool));
        pool.setYieldAdapter(address(adapter));
        pool.setDrawEngine(address(this));

        mirror.setOwnerOf(TOKEN_A, alice);
        mirror.setOwnerOf(TOKEN_B, bob);
        mirror.setOwnerOf(TOKEN_C, carol);

        usdc.mint(alice, 1_000_000 * ONE);
        usdc.mint(bob, 1_000_000 * ONE);
        usdc.mint(carol, 1_000_000 * ONE);
    }

    function _deposit(address who, uint256 tokenId, uint256 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(pool), amount);
        pool.deposit(tokenId, amount);
        vm.stopPrank();
    }

    // ---------- basic accounting ----------

    function test_Deposit_MintsSharesOneToOne() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        assertEq(pool.sharesOf(TOKEN_A), 100 * ONE);
        assertEq(pool.totalShares(), 100 * ONE);
        assertEq(pool.totalPrincipal(), 100 * ONE);
        (address depositor, uint256 shares, uint256 principal) = pool.depositOf(TOKEN_A);
        assertEq(depositor, alice);
        assertEq(shares, 100 * ONE);
        assertEq(principal, 100 * ONE);
        assertEq(adapter.principalDeployed(), 100 * ONE);
    }

    function test_Deposit_RevertsOnZero() public {
        vm.prank(alice);
        vm.expectRevert(IChogPool.ZeroAmount.selector);
        pool.deposit(TOKEN_A, 0);
    }

    function test_Deposit_RevertsForUnmirroredToken() public {
        vm.startPrank(alice);
        usdc.approve(address(pool), 10 * ONE);
        vm.expectRevert(abi.encodeWithSelector(IChogPool.NotBound.selector, 999));
        pool.deposit(999, 10 * ONE);
        vm.stopPrank();
    }

    function test_Deposit_RevertsWhenAnotherDepositorOwnsPosition() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.startPrank(bob);
        usdc.approve(address(pool), 10 * ONE);
        vm.expectRevert(abi.encodeWithSelector(IChogPool.NotMirrorOwner.selector, TOKEN_A, bob));
        pool.deposit(TOKEN_A, 10 * ONE);
        vm.stopPrank();
    }

    function test_OneWallet_MultipleChogs_IndependentBooks() public {
        // Alice owns two Chogs in the mirror; each gets its own position.
        mirror.setOwnerOf(TOKEN_B, alice);
        _deposit(alice, TOKEN_A, 100 * ONE);
        _deposit(alice, TOKEN_B, 50 * ONE);
        assertEq(pool.sharesOf(TOKEN_A), 100 * ONE);
        assertEq(pool.sharesOf(TOKEN_B), 50 * ONE);
        assertEq(pool.totalPrincipal(), 150 * ONE);
    }

    // ---------- withdrawal invariants ----------

    function test_Withdraw_ReturnsFullPrincipalInstantly() public {
        uint256 before = usdc.balanceOf(alice);
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        pool.withdrawAll(TOKEN_A);
        assertEq(usdc.balanceOf(alice), before, "principal must come back in full");
        assertEq(pool.sharesOf(TOKEN_A), 0);
        assertEq(pool.totalShares(), 0);
    }

    function test_WithdrawAll_UnderAdversarialSequence() public {
        // deposit -> warp -> deposit more -> withdraw all -> nothing stuck
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.warp(block.timestamp + 1 days);
        _deposit(alice, TOKEN_A, 250 * ONE);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        pool.withdrawAll(TOKEN_A);
        assertEq(pool.sharesOf(TOKEN_A), 0);
        assertEq(adapter.principalDeployed(), 0);
        assertEq(usdc.balanceOf(alice), 1_000_000 * ONE);
    }

    function test_Withdraw_Partial() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.prank(alice);
        pool.withdraw(TOKEN_A, 40 * ONE);
        assertEq(pool.sharesOf(TOKEN_A), 60 * ONE);
        assertEq(pool.totalShares(), 60 * ONE);
        assertEq(adapter.principalDeployed(), 60 * ONE);
    }

    function test_Withdraw_RevertsWhenTooManyShares() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IChogPool.InsufficientShares.selector, TOKEN_A, 101 * ONE, 100 * ONE)
        );
        pool.withdraw(TOKEN_A, 101 * ONE);
    }

    function test_Withdraw_RevertsForStranger() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IChogPool.NotMirrorOwner.selector, TOKEN_A, bob));
        pool.withdrawAll(TOKEN_A);
    }

    function test_Withdraw_RevertsForUnboundToken() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IChogPool.NotBound.selector, TOKEN_A));
        pool.withdrawAll(TOKEN_A);
    }

    // ---------- TWAB math vs closed form ----------

    /// Constant balance over a window: TWAB must equal that balance exactly.
    function test_Twab_ConstantBalance_EqualsBalance() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.warp(block.timestamp + 1 days);
        vm.warp(block.timestamp + 3 days);
        assertEq(pool.twabOfWindow(TOKEN_A, block.timestamp - 2 days, block.timestamp), 100 * ONE);
    }

    /// A balance that steps up once: TWAB is the time-weighted mean.
    function test_Twab_SingleStepChange_MatchesClosedForm() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.warp(block.timestamp + 1 days);
        _deposit(alice, TOKEN_A, 200 * ONE); // now 300
        vm.warp(block.timestamp + 3 days);

        // Window [t0, t0+4d]: 100 for 1 day, 300 for 3 days.
        uint256 t0 = block.timestamp - 4 days;
        uint256 expected = (100 * ONE * 1 days + 300 * ONE * 3 days) / 4 days;
        assertEq(pool.twabOfWindow(TOKEN_A, t0, block.timestamp), expected);
    }

    /// Zero-length window returns the instantaneous balance.
    function test_Twab_ZeroWindow_IsInstantaneous() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        assertEq(pool.twabOfWindow(TOKEN_A, block.timestamp, block.timestamp), 100 * ONE);
    }

    /// A balance that went to zero: the TWAB over the window that spans the drain
    /// must be the pre-drain average, not the current zero.
    function test_Twab_AfterFullWithdraw_AveragesHistoryNotCurrent() public {
        // Capture the window start BEFORE the balance changes, then drain at the
        // window midpoint. The average over the whole window must be 50, not the
        // current balance of 0 and not the peak of 100.
        _deposit(alice, TOKEN_A, 100 * ONE);
        uint256 t0 = block.timestamp;
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        pool.withdrawAll(TOKEN_A); // balance now 0
        vm.warp(block.timestamp + 2 days);
        // 100 for 2 days, 0 for 2 days -> time-weighted average 50.
        assertEq(pool.twabOfWindow(TOKEN_A, t0, block.timestamp), 50 * ONE);
        // And the instantaneous TWAB is 0, proving history is not what odds use now.
        assertEq(pool.twabOf(TOKEN_A), 0);
    }

    /// THE fairness property: a last-second whale buys almost no odds.
    /// A patient depositor with 1/10th the capital holds 10x the odds if the whale
    /// only deposits in the final second of the window.
    function test_Twab_SniperCannotBeatPatientDepositor() public {
        // Bob deposits early and holds.
        _deposit(bob, TOKEN_B, 100 * ONE);
        uint256 t0 = block.timestamp;
        vm.warp(block.timestamp + 9 days);

        // Alice snipes 1000 USDC one second before the draw closes.
        _deposit(alice, TOKEN_A, 1000 * ONE);
        vm.warp(block.timestamp + 1);

        uint256 bobTwab = pool.twabOfWindow(TOKEN_B, t0, block.timestamp);
        uint256 aliceTwab = pool.twabOfWindow(TOKEN_A, t0, block.timestamp);

        // Alice has 10x the capital but her TWAB is a rounding error next to Bob's.
        assertGt(bobTwab, aliceTwab, "patient depositor must out-weight the sniper");
        assertLt(aliceTwab, bobTwab / 100, "sniper TWAB must be < 1% of patient TWAB");
    }

    /// Fuzz: TWAB over a random sequence of deposits must match naive integration.
    function testFuzz_Twab_MatchesNaiveIntegration(uint8 steps, uint64 warpSeed) public {
        steps = uint8(bound(steps, 1, 8));
        uint256 balance = 0;
        uint256 cumulative; // balance × seconds
        uint256 lastTs = block.timestamp;
        uint256 windowStart = block.timestamp;

        for (uint256 i = 0; i < steps; i++) {
            uint256 amt = bound(uint256(keccak256(abi.encode(warpSeed, i))), 1, 500) * ONE;
            _deposit(alice, TOKEN_A, amt);
            balance += amt;

            uint64 dt = uint64(bound(uint256(keccak256(abi.encode(warpSeed, i, "dt"))), 1, 3 days));
            vm.warp(block.timestamp + dt);
            cumulative += balance * dt;
            lastTs = block.timestamp;
        }

        uint256 elapsed = lastTs - windowStart;
        uint256 expected = elapsed == 0 ? balance : cumulative / elapsed;
        assertEq(pool.twabOfWindow(TOKEN_A, windowStart, block.timestamp), expected);
    }

    /// Fuzz: the cumulative checkpoint surface must be consistent with TWAB.
    function testFuzz_CumulativeConsistency(uint64 warp1, uint64 warp2) public {
        warp1 = uint64(bound(warp1, 1, 2 days));
        warp2 = uint64(bound(warp2, 1, 2 days));

        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.warp(block.timestamp + warp1);
        uint256 c1 = pool.cumulativeOf(TOKEN_A, block.timestamp);
        vm.warp(block.timestamp + warp2);
        uint256 c2 = pool.cumulativeOf(TOKEN_A, block.timestamp);

        uint256 twab = pool.twabOfWindow(TOKEN_A, block.timestamp - warp2, block.timestamp);
        assertEq(twab, (c2 - c1) / warp2);
    }

    // ---------- window guards ----------

    function test_Twab_RevertsOnFutureTimestamp() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.expectRevert();
        pool.twabOfWindow(TOKEN_A, block.timestamp, block.timestamp + 1);
    }

    function test_Twab_RevertsOnReversedRange() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert();
        pool.twabOfWindow(TOKEN_A, block.timestamp, block.timestamp - 1 days);
    }

    function test_Twab_RevertsOnWindowTooLong() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.warp(block.timestamp + 61 days);
        vm.expectRevert();
        pool.twabOfWindow(TOKEN_A, block.timestamp - 61 days, block.timestamp);
    }

    // ---------- odds ----------

    function test_OddsBps_SumToOneHundredPercent() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        _deposit(bob, TOKEN_B, 300 * ONE);
        vm.warp(block.timestamp + 1 days);

        uint256 a = pool.oddsBpsOf(TOKEN_A);
        uint256 b = pool.oddsBpsOf(TOKEN_B);
        assertEq(a + b, 10_000);
        assertEq(a, 2500);
        assertEq(b, 7500);
    }

    function test_OddsBps_ZeroWhenEmpty() public view {
        assertEq(pool.oddsBpsOf(TOKEN_A), 0);
    }

    // ---------- pot ----------

    function test_Harvest_MovesRealizedYieldToPot() public {
        _deposit(alice, TOKEN_A, 100 * ONE);

        // Inject yield as if real LP fees had accrued inside the venue.
        usdc.mint(address(this), 7 * ONE);
        usdc.approve(address(adapter), 7 * ONE);
        adapter.injectYield(7 * ONE);

        uint256 harvested = pool.harvest();
        assertEq(harvested, 7 * ONE);
        assertEq(pool.potBalance(), 7 * ONE);
        // Principal untouched.
        assertEq(adapter.principalDeployed(), 100 * ONE);
    }

    function test_Harvest_RevertsWhenNothingAccrued() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.expectRevert(IYieldAdapter.NothingToHarvest.selector);
        pool.harvest();
    }

    function test_PayPot_OnlyDrawEngine() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        usdc.mint(address(this), 5 * ONE);
        usdc.approve(address(adapter), 5 * ONE);
        adapter.injectYield(5 * ONE);
        pool.harvest();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IChogPool.NotMirrorOwner.selector, 0, alice));
        pool.payPot(alice, 5 * ONE);

        pool.payPot(bob, 5 * ONE); // this test contract IS the draw engine
        assertEq(usdc.balanceOf(bob) - 1_000_000 * ONE, 5 * ONE);
        assertEq(pool.potBalance(), 0);
    }

    function test_PayPot_RevertsWhenPotTooSmall() public {
        vm.expectRevert(abi.encodeWithSelector(IChogPool.InsufficientPot.selector, 10 * ONE, 0));
        pool.payPot(bob, 10 * ONE);
    }

    // ---------- invariants across many actors ----------

    /// Sum of every position's shares must always equal totalShares.
    function testFuzz_ShareConservation(uint8 ops, uint64 seed) public {
        ops = uint8(bound(ops, 1, 12));
        uint256[3] memory tokens = [TOKEN_A, TOKEN_B, TOKEN_C];
        address[3] memory actors = [alice, bob, carol];

        for (uint256 i = 0; i < ops; i++) {
            uint256 idx = bound(uint256(keccak256(abi.encode(seed, i))), 0, 2);
            uint256 amt = bound(uint256(keccak256(abi.encode(seed, i, "amt"))), 1, 100) * ONE;
            uint256 ts = block.timestamp + 1;
            vm.warp(ts);
            _deposit(actors[idx], tokens[idx], amt);
        }

        uint256 sum = pool.sharesOf(TOKEN_A) + pool.sharesOf(TOKEN_B) + pool.sharesOf(TOKEN_C);
        assertEq(sum, pool.totalShares(), "share conservation");
        assertEq(sum, adapter.principalDeployed(), "principal must be fully deployed");
    }

    /// Everyone must always be able to withdraw their full principal.
    function testFuzz_FullPrincipalAlwaysWithdrawable(uint8 ops, uint64 seed) public {
        ops = uint8(bound(ops, 1, 10));
        uint256[3] memory tokens = [TOKEN_A, TOKEN_B, TOKEN_C];
        address[3] memory actors = [alice, bob, carol];
        uint256[3] memory deposited;

        for (uint256 i = 0; i < ops; i++) {
            uint256 idx = bound(uint256(keccak256(abi.encode(seed, i))), 0, 2);
            uint256 amt = bound(uint256(keccak256(abi.encode(seed, i, "amt"))), 1, 100) * ONE;
            vm.warp(block.timestamp + 1);
            _deposit(actors[idx], tokens[idx], amt);
            deposited[idx] += amt;
        }

        for (uint256 i = 0; i < 3; i++) {
            if (deposited[i] == 0) continue;
            uint256 before = usdc.balanceOf(actors[i]);
            vm.prank(actors[i]);
            pool.withdrawAll(tokens[i]);
            assertEq(usdc.balanceOf(actors[i]) - before, deposited[i], "full principal back");
        }
        assertEq(pool.totalShares(), 0);
        assertEq(adapter.principalDeployed(), 0);
    }
}
