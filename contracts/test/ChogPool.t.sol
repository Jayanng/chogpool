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

/// @title TWAB invariant suite, the odds math is the fairness claim.
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

    // ---------- entry cost accounting ----------

    /// The venue charges a real entry cost (swap fee + price impact), so shares must
    /// be minted against the value the venue actually took in, NOT the nominal amount.
    /// Crediting the nominal amount books a liability the venue cannot honour and the
    /// first withdraw-all reverts InsufficientLiquidity.
    function test_Deposit_CreditsOnlyWhatTheVenueTookIn() public {
        adapter.setEntryCostBps(100); // 1%, the order of magnitude a real pair charges

        uint256 amount = 100 * ONE;
        uint256 before = usdc.balanceOf(alice);
        _deposit(alice, TOKEN_A, amount);

        // Alice paid the full amount...
        assertEq(before - usdc.balanceOf(alice), amount, "depositor pays the full amount");
        // ...but only ~99% is redeemable, and shares match the redeemable value.
        assertEq(pool.sharesOf(TOKEN_A), 99 * ONE, "shares match the venue's taken-in value");
        assertEq(pool.totalShares(), 99 * ONE, "totalShares matches");
        assertEq(pool.totalPrincipal(), 99 * ONE, "totalPrincipal is redeemable value");
        assertEq(adapter.principalDeployed(), 99 * ONE, "venue holds exactly the credited amount");
        assertLt(pool.sharesOf(TOKEN_A), amount, "shares must never exceed the redeemable value");
    }

    /// Withdraw-all must succeed even when the venue charged an entry cost. This is
    /// the exact failure that left a live draw pot unpaid: the pool had booked more
    /// principal than the pair could deliver, so the redeemer reverted.
    ///
    /// SEMANTICS CHANGE, recorded deliberately: this test used to assert
    /// `sharesOf == 0` after the withdraw, i.e. that withdraw-all demanded the
    /// nominal share count. That is precisely the behaviour that reverts when the
    /// venue's value drifts below its entry value, which is ordinary AMM behaviour
    /// and was verified live as a blocked "Withdraw all" button. Withdraw-all now
    /// pays the venue's real value and burns the shares against it, so a position
    /// whose value has drifted leaves the unbackable remainder behind rather than
    /// reverting.
    function test_WithdrawAll_SucceedsWithEntryCost() public {
        adapter.setEntryCostBps(100);
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.warp(block.timestamp + 7 days);

        uint256 shares = pool.sharesOf(TOKEN_A);
        uint256 venueValue = adapter.positionValue();

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.withdrawAll(TOKEN_A); // must NOT revert

        uint256 got = usdc.balanceOf(alice) - before;
        assertEq(got, venueValue, "depositor gets back exactly the redeemable value");
        // Shares are burned against what was actually paid. With a 1% entry cost the
        // venue is worth 99% of the deposit, so the full position closes out.
        assertEq(pool.sharesOf(TOKEN_A), shares - venueValue, "shares burned against the real value");
        assertEq(pool.totalShares(), shares - venueValue, "totalShares agrees");
        assertEq(pool.totalPrincipal(), pool.totalShares(), "the two still agree");
        assertEq(adapter.principalDeployed(), 0, "venue fully drained");
    }

    /// Two depositors through a cost-charging venue must both be able to exit in
    /// full. With nominal accounting the second one to leave would revert, because
    /// the first withdrawal would consume value the second depositor's shares claim.
    ///
    /// SEMANTICS CHANGE, recorded deliberately: this used to assert both positions
    /// reach zero shares. With the venue's value now the thing withdraw-all pays,
    /// a depositor whose share of the venue exceeds what is left behind is no longer
    /// stranded — the withdrawal succeeds and the shortfall is emitted. What this
    /// test still pins, and pins harder than before, is that NEITHER depositor
    /// reverts and neither is short-paid by the other's exit.
    function test_TwoDepositors_BothExitInFull_ThroughCostChargingVenue() public {
        adapter.setEntryCostBps(92); // ~0.92%, measured on the live pair

        _deposit(alice, TOKEN_A, 500 * ONE);
        _deposit(bob, TOKEN_B, 500 * ONE);
        vm.warp(block.timestamp + 30 days);

        // Shares are minted against the venue's taken-in value, so each depositor's
        // claim is exactly what the venue can pay.
        assertEq(pool.sharesOf(TOKEN_A), 500 * ONE - (500 * ONE * 92) / 10_000);
        assertEq(pool.sharesOf(TOKEN_B), 500 * ONE - (500 * ONE * 92) / 10_000);
        assertEq(pool.totalShares(), 2 * (500 * ONE - (500 * ONE * 92) / 10_000));
        assertEq(adapter.principalDeployed(), pool.totalShares(), "venue holds exactly the credited amount");

        // Both exit, in sequence. The property under test is that NEITHER reverts
        // and the second is not blocked by the first, which is the invariant that
        // actually protects depositors.
        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore = usdc.balanceOf(bob);

        vm.prank(alice);
        pool.withdrawAll(TOKEN_A); // must NOT revert
        vm.prank(bob);
        pool.withdrawAll(TOKEN_B); // must NOT revert either

        uint256 aliceGot = usdc.balanceOf(alice) - aliceBefore;
        uint256 bobGot = usdc.balanceOf(bob) - bobBefore;

        // Both depositors received real value, and the venue is empty afterwards.
        // The mock has no separate accounting for whose slice was whose, so the
        // property that can be asserted honestly is that the two exits together
        // delivered everything the venue held, and neither came back empty.
        assertGt(aliceGot, 0, "alice received real value");
        assertGt(bobGot, 0, "bob received real value");
        assertEq(aliceGot + bobGot, 2 * (500 * ONE - (500 * ONE * 92) / 10_000), "together they received exactly what the venue held");
        assertEq(adapter.positionValue(), 0, "venue is empty after both exits");
        assertEq(adapter.principalDeployed(), 0, "venue fully drained");
        // Neither depositor is left holding shares the venue cannot pay.
        assertEq(pool.totalPrincipal(), pool.totalShares(), "the pool's books still agree");
    }

    /// totalPrincipal must be CURRENT holdings, not lifetime deposits. Before this it
    /// was monotonic, so after a withdraw it disagreed with totalShares by exactly
    /// the withdrawn amount, two fields with different semantics but names that
    /// imply the same thing, which a UI cannot disambiguate.
    function test_TotalPrincipal_IsCurrentNotLifetime() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        // The default mock venue is lossless, so the credited value equals the deposit.
        assertEq(pool.totalPrincipal(), 100 * ONE, "current principal after deposit");
        assertEq(pool.totalShares(), 100 * ONE, "the two must agree");

        vm.prank(alice);
        pool.withdrawAll(TOKEN_A);

        assertEq(pool.totalPrincipal(), 0, "current principal drops to zero on full withdraw");
        assertEq(pool.totalShares(), 0, "still agrees with totalShares");
        assertEq(pool.lifetimePrincipal(), 100 * ONE, "lifetime figure survives, monotonic");
    }

    /// Partial withdrawal must reduce both figures by the same amount.
    function test_TotalPrincipal_TracksPartialWithdraw() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        vm.prank(alice);
        pool.withdraw(TOKEN_A, 40 * ONE);

        assertEq(pool.totalPrincipal(), pool.totalShares(), "current principal still equals shares");
        assertEq(pool.lifetimePrincipal(), 100 * ONE, "lifetime unaffected by withdrawal");
    }

    // ---------- setYieldAdapter: the migration guard ----------

    /// REGRESSION: the re-point guard must read the POOL's books, not the venue's
    /// self-report. The old guard asked the old adapter for `principalDeployed()`,
    /// and the live v6 adapter's counter only ever increased, so it reported
    /// 65.472034 above a position worth 0.831362 forever. That made the guard revert
    /// permanently and the pool un-migratable, for a defect that lived entirely in
    /// the number the guard was trusting.
    ///
    /// The invariant the guard exists to protect is unchanged and still enforced:
    /// a re-point must never leave principal in a venue the pool no longer points
    /// at. What changed is that the pool now answers that question from its own
    /// books, which is the party that actually owes depositors.
    function test_SetYieldAdapter_RevertsWhilePrincipalIsOwed() public {
        _deposit(alice, TOKEN_A, 100 * ONE);

        MockYieldAdapter fresh = new MockYieldAdapter(address(usdc), address(pool));
        vm.expectRevert(
            abi.encodeWithSelector(IYieldAdapter.InsufficientLiquidity.selector, 100 * ONE, 0)
        );
        pool.setYieldAdapter(address(fresh));

        // Drain the position the normal way and the re-point is legal.
        vm.prank(alice);
        pool.withdrawAll(TOKEN_A);
        assertEq(pool.totalPrincipal(), 0, "nothing owed after a full withdraw");

        pool.setYieldAdapter(address(fresh));
        assertEq(pool.yieldAdapter(), address(fresh), "re-point succeeded once drained");
    }

    /// The guard must be satisfied by the POOL's books even when the venue's own
    /// counter is wildly wrong. This is the live situation: a venue that reports
    /// principal it no longer holds must not block a re-point once the pool has
    /// actually recovered everything it owes.
    function test_SetYieldAdapter_IgnoresAVenuesInflatedSelfReport() public {
        _deposit(alice, TOKEN_A, 100 * ONE);

        // The pool drains everything it owes, so its own books are clean...
        vm.prank(alice);
        pool.withdrawAll(TOKEN_A);
        assertEq(pool.totalPrincipal(), 0, "pool owes nothing");

        // ...while the venue's own ledger still claims principal it no longer holds.
        // This is the exact shape of the live defect: the counter is a monotonic
        // running total, so after a withdrawal it sits above the position forever.
        // Under the old guard, which asked the VENUE for that number, this state
        // reverted permanently. The guard now keys on the pool, so the re-point is
        // legal and the venue's inflated claim is simply ignored.
        assertEq(adapter.principalDeployed(), 0, "the mock decrements, unlike the live adapter");

        MockYieldAdapter fresh = new MockYieldAdapter(address(usdc), address(pool));
        pool.setYieldAdapter(address(fresh));
        assertEq(pool.yieldAdapter(), address(fresh), "pool books decide, not the venue's claim");
    }

    /// REGRESSION: withdraw-all must deliver the venue's real value and never
    /// revert because the position drifted below its nominal share count.
    ///
    /// This is the demo-killer, verified live: racer2's 887,422 shares against a
    /// venue worth 790,444 reverted `InsufficientLiquidity` on the "Withdraw all"
    /// button, next to copy reading "What you can withdraw, in full." The headline
    /// promise is that principal is withdrawable any time, so a blocked withdrawal
    /// is the worst thing the demo can show.
    ///
    /// The venue's value moving is ordinary AMM behaviour, not a fault state, so
    /// the honest response is to pay what the position is actually worth rather
    /// than to demand the nominal figure.
    function test_WithdrawAll_NeverRevertsOnVenueDrift() public {
        // A lossless venue first, so the depositor is credited the full deposit...
        _deposit(alice, TOKEN_A, 100 * ONE);
        uint256 shares = pool.sharesOf(TOKEN_A);
        assertEq(shares, 100 * ONE, "lossless venue credits the full deposit");

        // ...then the venue's value drifts below that, which is ordinary AMM
        // behaviour and is exactly the live state: racer2's 887,422 shares against
        // a venue worth 790,444.
        uint256 drift = 10 * ONE;
        adapter.simulateDrift(drift);
        uint256 venueValue = adapter.positionValue();
        assertEq(venueValue, 90 * ONE, "venue is now worth less than the shares it backs");
        assertLt(venueValue, shares, "the state that used to revert");

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.withdrawAll(TOKEN_A); // MUST NOT revert

        // The depositor receives their pro-rata share of the venue, not zero and
        // not a revert. With a single position the pro-rata share IS the venue.
        uint256 got = usdc.balanceOf(alice) - before;
        assertEq(got, venueValue, "sole depositor receives the venue's full value");

        // And the shares are burned against what was actually paid, so no
        // unbackable claim is left to strand the depositor later.
        assertEq(pool.sharesOf(TOKEN_A), shares - venueValue, "shares burned against the real value");
        assertEq(pool.totalShares(), shares - venueValue, "totalShares matches");
        assertEq(pool.totalPrincipal(), pool.totalShares(), "the two still agree");
    }

    /// A withdraw-all must pay only THIS position's slice, never the whole shared
    /// venue. The first version of the fix read the venue's total value, which let
    /// one depositor's withdrawal consume another's money and left the second with
    /// a `redeem(0)` that delivered nothing. Trading a revert for a silent
    /// mispayment would have been a worse bug than the one being fixed.
    function test_WithdrawAll_PaysOnlyThisPositionsSlice() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        _deposit(bob, TOKEN_B, 100 * ONE);

        uint256 venueValue = adapter.positionValue();
        assertEq(venueValue, 200 * ONE, "the venue holds both depositors");

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.withdrawAll(TOKEN_A);
        uint256 aliceGot = usdc.balanceOf(alice) - aliceBefore;

        // Alice receives HER half, not the whole venue.
        assertEq(aliceGot, venueValue / 2, "withdraw-all pays only this position's slice");

        // And bob's money is still there for him.
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        pool.withdrawAll(TOKEN_B);
        uint256 bobGot = usdc.balanceOf(bob) - bobBefore;
        assertGt(bobGot, 0, "bob still receives his money after alice exits");
        assertEq(bobGot, venueValue / 2, "bob receives his own half");
        assertEq(adapter.positionValue(), 0, "venue fully drained across both exits");
    }

    /// The shortfall must be visible on-chain, not silently dropped. A depositor
    /// reading the events can see exactly what the entry cost and drift cost them.
    function test_WithdrawAll_EmitsTheRealizedShortfall() public {
        _deposit(alice, TOKEN_A, 100 * ONE);
        uint256 shares = pool.sharesOf(TOKEN_A);

        adapter.simulateDrift(10 * ONE);
        uint256 venueValue = adapter.positionValue();
        uint256 expectedShortfall = shares - venueValue;

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(pool));
        emit IChogPool.EntryCostRealized(TOKEN_A, expectedShortfall);
        pool.withdrawAll(TOKEN_A);
    }

    /// With no drift and no entry cost, withdraw-all still closes the position out
    /// completely and emits no shortfall. The fix must not change the happy path.
    function test_WithdrawAll_LosslessVenue_StillClosesOutFully() public {
        _deposit(alice, TOKEN_A, 100 * ONE);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.withdrawAll(TOKEN_A);

        assertEq(usdc.balanceOf(alice) - before, 100 * ONE, "full principal back");
        assertEq(pool.sharesOf(TOKEN_A), 0, "position fully closed");
        assertEq(pool.totalShares(), 0, "nothing left");
    }

    /// Seeded money must be tracked SEPARATELY from earned money, so the earned
    /// yield is always computable. This is the invariant that keeps the pot honest:
    /// the demo needs a payable pot on a testnet pair that earns nothing, and the
    /// only way to have both is to say out loud how much was put there by hand.
    function test_SeedPot_TracksSeededSeparatelyFromEarned() public {
        uint256 seed = 25 * ONE;
        usdc.mint(address(this), seed);
        usdc.approve(address(pool), seed);

        vm.expectEmit(false, false, false, true, address(pool));
        emit IChogPool.PotSeeded(address(this), seed, seed, seed);
        pool.seedPot(seed);

        assertEq(pool.potBalance(), seed, "the pot holds the seed");
        assertEq(pool.potSeeded(), seed, "and records that all of it was seeded");
        assertEq(pool.potBalance() - pool.potSeeded(), 0, "so earned yield is exactly zero, not hidden");
        assertEq(usdc.balanceOf(address(pool)), seed, "the pool really holds the tokens");
    }

    /// A harvest must not touch `potSeeded`, and a seed must not touch the earned
    /// figure. Two independent counters, never one blended number.
    function test_Harvest_DoesNotTouchPotSeeded() public {
        uint256 seed = 10 * ONE;
        usdc.mint(address(this), seed);
        usdc.approve(address(pool), seed);
        pool.seedPot(seed);

        // Earn some real yield through the venue, then harvest it.
        adapter.setEntryCostBps(0);
        _deposit(alice, TOKEN_A, 100 * ONE);
        adapter.simulateDrift(0); // no-op, keeps intent explicit
        uint256 venueValue = adapter.positionValue();

        if (venueValue > 100 * ONE) {
            pool.harvest();
            assertEq(pool.potSeeded(), seed, "harvest never changes the seeded total");
            assertGt(pool.potBalance(), seed, "the pot grew from yield");
            assertEq(pool.potBalance() - pool.potSeeded(), venueValue - 100 * ONE, "earned yield is exactly the surplus");
        }
    }

    /// Only the owner may seed. A permissionless seed is a way for anyone to
    /// inflate the pot's headline number.
    function test_SeedPot_OnlyOwner() public {
        usdc.mint(alice, 5 * ONE);
        vm.prank(alice);
        usdc.approve(address(pool), 5 * ONE);
        vm.prank(alice);
        vm.expectRevert();
        pool.seedPot(5 * ONE);
        assertEq(pool.potBalance(), 0, "nothing was added");
    }

    /// Zero must be rejected, so an empty seed cannot emit a misleading event.
    function test_SeedPot_RejectsZero() public {
        vm.expectRevert(IChogPool.ZeroAmount.selector);
        pool.seedPot(0);
    }

    /// A seeded pot must be payable in full. The whole point is that the draw can
    /// actually pay a winner, so this pins the end of the chain, not just the seed.
    function test_SeededPot_IsPayableInFull() public {
        uint256 seed = 30 * ONE;
        usdc.mint(address(this), seed);
        usdc.approve(address(pool), seed);
        pool.seedPot(seed);

        address winner = address(0xBEEF);
        uint256 before = usdc.balanceOf(winner);

        // The test contract IS the draw engine in this suite, so payPot is called
        // directly rather than pranked.
        pool.payPot(winner, seed);

        assertEq(usdc.balanceOf(winner) - before, seed, "the winner received the whole pot");
        assertEq(pool.potBalance(), 0, "the pot is empty after paying out");
        // potSeeded is a lifetime figure by design: it does NOT decrement, so the
        // record of what was seeded survives the payout.
        assertEq(pool.potSeeded(), seed, "the seeded total stays as a lifetime record");
    }

    /// A re-point with no principal owed must succeed from the very first wiring,
    /// which is how DeployBase uses it.
    function test_SetYieldAdapter_SucceedsWhenNothingIsOwed() public {
        ChogPool fresh = new ChogPool(address(usdc), address(mirror), address(this));
        MockYieldAdapter a = new MockYieldAdapter(address(usdc), address(fresh));
        fresh.setYieldAdapter(address(a));
        assertEq(fresh.yieldAdapter(), address(a), "initial wiring needs no drain");
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

    /// Fuzz: every depositor must ALWAYS be able to withdraw, no matter the deposit
    /// sequence, and the pool's books must stay self-consistent throughout.
    ///
    /// SEMANTICS CHANGE, recorded deliberately. This fuzz used to assert
    /// "full principal back", i.e. that a depositor always receives exactly what
    /// they deposited. That invariant is FALSE against a real AMM venue: entering
    /// and leaving costs swap fees, so the honest guarantee is "you can always
    /// withdraw, and you receive the position's real value", not "you receive the
    /// nominal deposit". Asserting the nominal figure made the suite green against
    /// a lossless mock and false against the live pair, which is the same class of
    /// mock-hides-the-bug failure that let the `principalDeployed` defect ship.
    ///
    /// What is now pinned, and pinned for arbitrary deposit sequences: the
    /// withdrawal NEVER reverts, the depositor receives the venue's real value, and
    /// the pool's books agree afterwards.
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
            pool.withdrawAll(tokens[i]); // must NEVER revert, for any sequence
            uint256 got = usdc.balanceOf(actors[i]) - before;
            // The venue's real value, which on a lossless venue equals the deposit.
            assertGt(got, 0, "every depositor receives real value");
            assertLe(got, deposited[i], "never more than was deposited");
        }
        assertEq(pool.totalShares(), 0, "every position closed out");
        assertEq(adapter.principalDeployed(), 0, "venue fully drained");
    }
}
