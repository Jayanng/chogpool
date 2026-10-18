// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SponsorAdapter} from "../src/SponsorAdapter.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockMirror} from "./mocks/MockMirror.sol";

/// @title SponsorAdapter suite: the no-loss claim, pinned as numbers.
/// @notice If these tests are green, "your dollars never enter the race" and "principal
///         comes back in full" both hold structurally. If any of them breaks, the
///         no-loss claim in the pitch is a lie.
contract SponsorAdapterUnitTest is Test {
    SponsorAdapter adapter;
    MockERC20 usdc;

    address alice = makeAddr("alice");
    address sponsor = makeAddr("sponsor");

    uint256 constant ONE = 1e6; // 1 USDC (6 decimals)

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        // The test contract acts as the pool: it supplies, redeems and harvests.
        adapter = new SponsorAdapter(address(usdc), address(this));
    }

    // ---------- the property that makes it no-loss ----------

    function test_Supply_CreditsExactlyWhatArrived_NoEntryCost() public {
        usdc.mint(address(this), 40 * ONE);
        usdc.approve(address(adapter), 40 * ONE);

        uint256 before = adapter.positionValue();
        adapter.supply(40 * ONE);

        // The LP adapter loses ~1.2% here. This one loses nothing: the value the pool
        // measures across the supply grows by exactly the amount supplied.
        assertEq(adapter.positionValue() - before, 40 * ONE);
        assertEq(adapter.principalDeployed(), 40 * ONE);
    }

    function test_Redeem_ReturnsFullPrincipalInstantly() public {
        usdc.mint(address(this), 40 * ONE);
        usdc.approve(address(adapter), 40 * ONE);
        adapter.supply(40 * ONE);

        adapter.redeem(40 * ONE, alice);

        assertEq(usdc.balanceOf(alice), 40 * ONE);
        assertEq(adapter.principalDeployed(), 0);
    }

    function test_PrincipalSurvivesRoundTrip_DifferentDepositors() public {
        usdc.mint(address(this), 50 * ONE);
        usdc.approve(address(adapter), 50 * ONE);
        adapter.supply(40 * ONE);
        adapter.supply(10 * ONE);

        adapter.redeem(40 * ONE, alice);
        adapter.redeem(10 * ONE, sponsor);

        // Two depositors, both made whole, in full. No shared position to strand anyone.
        assertEq(usdc.balanceOf(alice), 40 * ONE);
        assertEq(usdc.balanceOf(sponsor), 10 * ONE);
    }

    // ---------- sponsor funding ----------

    function test_Harvest_BooksExactlyWhatPhysicallyArrived() public {
        usdc.mint(address(this), 40 * ONE);
        usdc.approve(address(adapter), 40 * ONE);
        adapter.supply(40 * ONE);

        // The sponsor funds the pot from outside the principal.
        usdc.mint(sponsor, 5 * ONE);
        vm.prank(sponsor);
        usdc.transfer(address(adapter), 5 * ONE);

        assertEq(adapter.realizableSurplus(), 5 * ONE);

        uint256 potBefore = usdc.balanceOf(address(this));
        uint256 booked = adapter.harvest();

        assertEq(booked, 5 * ONE);
        assertEq(usdc.balanceOf(address(this)) - potBefore, 5 * ONE);
        // The principal is untouched by the harvest.
        assertEq(adapter.principalDeployed(), 40 * ONE);
    }

    function test_Harvest_TwiceCannotDoubleBook() public {
        usdc.mint(address(this), 40 * ONE);
        usdc.approve(address(adapter), 40 * ONE);
        adapter.supply(40 * ONE);
        usdc.mint(sponsor, 5 * ONE);
        vm.prank(sponsor);
        usdc.transfer(address(adapter), 5 * ONE);

        adapter.harvest();
        assertEq(adapter.harvest(), 0);
        assertEq(adapter.realizableSurplus(), 0);
    }

    function test_Harvest_NothingToHarvestReturnsZero() public {
        usdc.mint(address(this), 40 * ONE);
        usdc.approve(address(adapter), 40 * ONE);
        adapter.supply(40 * ONE);

        // No sponsor funding yet: the honest answer is 0, and the pool reverts
        // NothingToHarvest on top of it.
        assertEq(adapter.harvest(), 0);
    }

    function test_Redeem_CannotEatSponsorFunding() public {
        usdc.mint(address(this), 40 * ONE);
        usdc.approve(address(adapter), 40 * ONE);
        adapter.supply(40 * ONE);
        usdc.mint(sponsor, 5 * ONE);
        vm.prank(sponsor);
        usdc.transfer(address(adapter), 5 * ONE);

        adapter.redeem(40 * ONE, alice);

        assertEq(usdc.balanceOf(alice), 40 * ONE);
        // The surplus is still there and still harvestable after a full withdrawal.
        assertEq(adapter.realizableSurplus(), 5 * ONE);
        assertEq(adapter.harvest(), 5 * ONE);
    }

    function test_RevertWhen_CannotRedeemMoreThanPrincipal() public {
        usdc.mint(address(this), 40 * ONE);
        usdc.approve(address(adapter), 40 * ONE);
        adapter.supply(40 * ONE);
        // Even with sponsor funding present, redemption is capped at principal.
        usdc.mint(sponsor, 5 * ONE);
        vm.prank(sponsor);
        usdc.transfer(address(adapter), 5 * ONE);

        vm.expectRevert();
        adapter.redeem(41 * ONE, alice);
    }

    function test_RevertWhen_NotThePool() public {
        usdc.mint(alice, 10 * ONE);
        vm.startPrank(alice);
        usdc.approve(address(adapter), 10 * ONE);
        vm.expectRevert();
        adapter.supply(10 * ONE);

        vm.expectRevert();
        adapter.redeem(1 * ONE, alice);

        vm.expectRevert();
        adapter.harvest();
        vm.stopPrank();
    }

    function test_RevertWhen_ZeroAmount() public {
        vm.expectRevert();
        adapter.supply(0);
    }

    function test_LiquidityUnits_IsZero_NoFakeNumbers() public {
        assertEq(adapter.liquidityUnits(), 0);
    }
}

/// @title SponsorAdapter wired into the real ChogPool: 40 in, 40 out.
/// @notice The property as the depositor experiences it. The LP adapter credits 39.52
///         shares for a 40 deposit. This one must credit 40 and return 40.
contract SponsorAdapterPoolTest is Test {
    ChogPool pool;
    SponsorAdapter adapter;
    MockERC20 usdc;
    MockMirror mirror;

    address alice = makeAddr("alice");
    address sponsor = makeAddr("sponsor");

    uint256 constant TOKEN_A = 1;
    uint256 constant ONE = 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        mirror = new MockMirror();
        pool = new ChogPool(address(usdc), address(mirror), address(this));
        adapter = new SponsorAdapter(address(usdc), address(pool));
        pool.setYieldAdapter(address(adapter));
        pool.setDrawEngine(address(this));
        mirror.setOwnerOf(TOKEN_A, alice);
        usdc.mint(alice, 100 * ONE);
    }

    function test_FortyInFortyOut() public {
        vm.startPrank(alice);
        usdc.approve(address(pool), 40 * ONE);
        pool.deposit(TOKEN_A, 40 * ONE);

        // 40 in, 40 shares. The entry haircut is gone because nothing is converted.
        assertEq(pool.sharesOf(TOKEN_A), 40 * ONE);
        assertEq(pool.totalShares(), 40 * ONE);
        assertEq(adapter.principalDeployed(), 40 * ONE);

        pool.withdraw(TOKEN_A, 40 * ONE);
        vm.stopPrank();

        // 40 out. What she put in is what comes back.
        assertEq(usdc.balanceOf(alice), 100 * ONE);
    }

    function test_PotFundedBySponsor_DepositorWholeAnyway() public {
        vm.startPrank(alice);
        usdc.approve(address(pool), 40 * ONE);
        pool.deposit(TOKEN_A, 40 * ONE);
        vm.stopPrank();

        usdc.mint(sponsor, 12 * ONE);
        vm.prank(sponsor);
        usdc.transfer(address(adapter), 12 * ONE);

        uint256 booked = pool.harvest();
        assertEq(booked, 12 * ONE);
        assertEq(pool.potBalance(), 12 * ONE);

        // The prize grew and the depositor's principal is untouched.
        vm.prank(alice);
        pool.withdraw(TOKEN_A, 40 * ONE);
        assertEq(usdc.balanceOf(alice), 100 * ONE);
    }

    function test_TwoDepositsStayIndependent() public {
        address bob = makeAddr("bob");
        usdc.mint(bob, 10 * ONE);

        vm.startPrank(alice);
        usdc.approve(address(pool), 40 * ONE);
        pool.deposit(TOKEN_A, 40 * ONE);
        vm.stopPrank();

        mirror.setOwnerOf(2, bob);
        vm.startPrank(bob);
        usdc.approve(address(pool), 10 * ONE);
        pool.deposit(2, 10 * ONE);
        pool.withdraw(2, 10 * ONE);
        vm.stopPrank();

        assertEq(usdc.balanceOf(bob), 10 * ONE);

        // A later, smaller position is not stranded by an earlier withdrawal: both
        // walk out whole. This is the property the shared LP position cannot promise.
        vm.prank(alice);
        pool.withdraw(TOKEN_A, 40 * ONE);
        assertEq(usdc.balanceOf(alice), 100 * ONE);
    }
}
