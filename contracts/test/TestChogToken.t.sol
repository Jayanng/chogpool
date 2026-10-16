// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestChogToken} from "../src/TestChogToken.sol";
import {ITestChogToken} from "../interfaces/ITestChogToken.sol";

/// @title TestChogToken suite, the play-money token's faucet and labelling rules.
/// @notice These tests guard the two properties that keep the token honest: the
///         name/symbol really do say "Test", and the faucet is capped
///         per address per cooldown so side prizes stay meaningful.
contract TestChogTokenTest is Test {
    TestChogToken token;

    address owner_ = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant CLAIM = 1_000e18; // 1,000 Test CHOG
    uint64 constant COOLDOWN = 24 hours;

    function setUp() public {
        token = new TestChogToken(owner_, CLAIM, COOLDOWN);
    }

    // ---------- labelling ----------

    /// The token must never be confusable with the real mainnet $CHOG.
    function test_Label_IsExplicitlyTest() public {
        assertEq(token.name(), "Test CHOG", "name must say Test");
        assertEq(token.symbol(), "Test CHOG", "symbol must say Test");
        assertEq(token.testLabel(), "Test CHOG", "UI label must say Test");
        assertEq(token.decimals(), 18);
    }

    // ---------- faucet ----------

    function test_Claim_MintsFaucetAmount() public {
        vm.prank(alice);
        token.claim();

        assertEq(token.balanceOf(alice), CLAIM);
        assertEq(token.totalSupply(), CLAIM);
    }

    function test_Claim_FirstClaimAlwaysAllowed() public {
        // A never-claimed address must not be blocked by a cooldown.
        assertEq(token.nextClaimAt(alice), 0, "no cooldown before the first claim");

        vm.prank(alice);
        token.claim();

        assertEq(token.nextClaimAt(alice), uint64(block.timestamp + COOLDOWN));
    }

    function test_Claim_CooldownBlocksSecondClaim() public {
        vm.prank(alice);
        token.claim();

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ITestChogToken.CooldownActive.selector, uint64(block.timestamp + COOLDOWN))
        );
        token.claim();

        // Still only one claim's worth of supply.
        assertEq(token.balanceOf(alice), CLAIM);
        assertEq(token.totalSupply(), CLAIM);
    }

    function test_Claim_AllowedAgainAfterCooldown() public {
        vm.prank(alice);
        token.claim();

        vm.warp(block.timestamp + COOLDOWN + 1);
        assertEq(token.nextClaimAt(alice), 0, "cooldown has elapsed");

        vm.prank(alice);
        token.claim();

        assertEq(token.balanceOf(alice), 2 * CLAIM, "second claim lands after the cooldown");
        assertEq(token.totalSupply(), 2 * CLAIM);
    }

    function test_Claim_ExactlyAtCooldownBoundary() public {
        vm.prank(alice);
        token.claim();
        uint256 claimTime = block.timestamp;

        // One second before the boundary: still blocked.
        vm.warp(claimTime + COOLDOWN - 1);
        vm.prank(alice);
        vm.expectRevert();
        token.claim();

        // Exactly at the boundary: allowed.
        vm.warp(claimTime + COOLDOWN);
        vm.prank(alice);
        token.claim();
        assertEq(token.balanceOf(alice), 2 * CLAIM);
    }

    /// The cap must be per address, not global, a second wallet can still claim.
    function test_Claim_CooldownIsPerAddress() public {
        vm.prank(alice);
        token.claim();
        vm.prank(bob);
        token.claim();

        assertEq(token.balanceOf(alice), CLAIM);
        assertEq(token.balanceOf(bob), CLAIM);
        assertEq(token.totalSupply(), 2 * CLAIM);
    }

    function test_Claim_EmitsEvent() public {
        vm.expectEmit(true, false, false, true, address(token));
        emit ITestChogToken.Claimed(alice, CLAIM, uint64(block.timestamp + COOLDOWN));
        vm.prank(alice);
        token.claim();
    }

    // ---------- admin ----------

    function test_SetClaimAmount_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        token.setClaimAmount(500e18);
    }

    function test_SetClaimAmount_AppliesToNextClaim() public {
        vm.prank(owner_);
        token.setClaimAmount(500e18);

        vm.prank(alice);
        token.claim();
        assertEq(token.balanceOf(alice), 500e18);
    }

    function test_SetClaimAmount_RejectsZero() public {
        vm.prank(owner_);
        vm.expectRevert(TestChogToken.ZeroAmount.selector);
        token.setClaimAmount(0);
    }

    function test_SetClaimCooldown_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        token.setClaimCooldown(1 hours);
    }

    /// A cooldown change must not strand an address: the UI countdown and the
    /// contract's guard both read nextClaimAt(), so shortening the cooldown takes
    /// effect immediately for both.
    function test_NextClaimAt_ClampsAfterCooldownShortening() public {
        vm.prank(alice);
        token.claim();
        uint256 claimTime = block.timestamp;

        // While on the 24h cooldown, the countdown is real.
        assertEq(token.nextClaimAt(alice), uint64(claimTime + COOLDOWN));

        // Shorten the cooldown so the stored nextClaimAt is in the past.
        vm.prank(owner_);
        token.setClaimCooldown(1 hours);

        // Before the shortened window elapses, the countdown reflects the NEW value.
        assertEq(token.nextClaimAt(alice), uint64(claimTime + 1 hours));

        vm.warp(claimTime + 1 hours + 1);
        assertEq(token.nextClaimAt(alice), 0, "an elapsed cooldown must read as 0");

        vm.prank(alice);
        token.claim();
        assertEq(token.balanceOf(alice), 2 * CLAIM);
    }

    function test_Constructor_RejectsZeroClaimAmount() public {
        vm.expectRevert(TestChogToken.ZeroAmount.selector);
        new TestChogToken(owner_, 0, COOLDOWN);
    }

    function test_BurnFrom_OnlyOwner() public {
        vm.prank(alice);
        token.claim();

        vm.prank(alice);
        vm.expectRevert();
        token.burnFrom(alice, CLAIM);

        vm.prank(owner_);
        token.burnFrom(alice, CLAIM);
        assertEq(token.balanceOf(alice), 0);
    }
}
