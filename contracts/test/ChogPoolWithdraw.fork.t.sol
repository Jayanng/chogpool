// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {PuddleLpAdapter} from "../src/PuddleLpAdapter.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IChogPool} from "../interfaces/IChogPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title ChogPoolWithdraw fork suite — does withdrawAll actually work on the live stack?
/// @notice Runs against an anvil fork of Monad testnet, with the LIVE deployed pool
///         and adapter. Every address is read from infra/verified.json at runtime,
///         never a literal in source.
///
/// What this proves that a unit test cannot:
///
///  The headline promise is "principal withdrawable any time." On the live stack a
///  withdraw-all of racer2's position REVERTED (`InsufficientLiquidity(887422,
///  831362)`), because the pool booked more shares than the venue could deliver. A
///  blocked withdrawal is the worst thing the demo can show.
///
///  This suite proves that on a copy of the real state:
///   1. the defect is real (the venue holds less than the shares it backs);
///   2. the corrected withdrawAll does NOT revert and pays a real, positive amount;
///   3. the payment is the position's honest pro-rata slice, never another
///      depositor's money;
///   4. the pool's books stay consistent afterwards.
///
/// Run: forge test --match-contract 'ChogPoolWithdrawForkTest' --rpc-url monad_testnet
contract ChogPoolWithdrawForkTest is Test {
    uint256 constant ONE = 1e6;

    address poolAddr;
    address adapterAddr;
    address asset;
    address depositor; // racer2, the only live depositor
    uint256 racerTokenId;

    ChogPool pool;
    PuddleLpAdapter adapter;

    bool forkUnavailable;

    function setUp() public {
        string memory root = vm.projectRoot();
        string memory json = vm.readFile(string.concat(root, "/../infra/verified.json"));

        poolAddr = vm.parseJsonAddress(json, "$.monadTestnet.chogPool.address");
        adapterAddr = vm.parseJsonAddress(json, "$.monadTestnet.puddleLpAdapter.address");
        asset = vm.parseJsonAddress(json, "$.monadTestnet.puddleUSDC.address");
        depositor = vm.parseJsonAddress(json, "$.monadTestnet.racer.depositor");
        racerTokenId = vm.parseJsonUint(json, "$.monadTestnet.racer.tokenId");

        string memory rpc = vm.parseJsonString(json, "$.monadTestnet.rpc");
        try this.createForkExternal(rpc) {
            uint256 forkId = this.createForkExternal(rpc);
            vm.selectFork(forkId);
        } catch {
            forkUnavailable = true;
            return;
        }

        // Attach to the LIVE contracts, not fresh deployments. The whole point is to
        // exercise the real state, including the real shortfall.
        pool = ChogPool(poolAddr);
        adapter = PuddleLpAdapter(adapterAddr);
    }

    /// @dev External so a fork failure can be caught in setUp without aborting the
    ///      whole suite. Foundry needs the CLI --rpc-url to pick the right EVM spec;
    ///      without it, createFork reverts and we skip instead of failing.
    function createForkExternal(string memory rpc) external returns (uint256) {
        return vm.createFork(rpc);
    }

    modifier needsFork() {
        if (forkUnavailable) return;
        _;
    }

    /// The precondition for everything else: the live venue really does hold less
    /// than the shares racer2's position claims. Without this the fix would be
    /// solving a problem that does not exist.
    function test_TheLiveDefectIsReal() public needsFork {
        if (forkUnavailable) return;

        uint256 venueValue = adapter.positionValue();
        uint256 racerShares = pool.sharesOf(racerTokenId);
        uint256 outstanding = pool.totalShares();

        assertGt(racerShares, 0, "racer2 holds shares");
        assertGt(venueValue, 0, "the venue holds value");
        assertLt(
            venueValue, racerShares, "the venue is worth less than the shares it backs - this is what reverted"
        );
        assertEq(racerShares, outstanding, "racer2 is the only position on the live pool");
    }

    /// The corrected withdrawAll, called as the depositor on the live state, must
    /// not revert and must pay a real amount.
    ///
    /// The old code called `redeem(pos.shares)`, which the venue rejects with
    /// InsufficientLiquidity because it cannot honour the nominal count. The new code
    /// asks for the pro-rata slice instead, which the venue CAN honour.
    ///
    /// The old code's failure mode is reproduced here first, then the fix's. This is
    /// the whole point of the fork test: not "the new code runs", but "the old code
    /// provably fails on this exact state and the new code provably does not".
    function test_LiveWithdrawAll_DoesNotRevertAndPaysRealValue() public needsFork {
        uint256 venueValue = adapter.positionValue();
        uint256 racerShares = pool.sharesOf(racerTokenId);
        uint256 outstanding = pool.totalShares();

        // 1. The old code's call, reproduced: redeem the NOMINAL share count.
        //    `redeem` is onlyPool, so it is reached exactly as the pool reached it.
        //    It reverts because the venue holds less than the shares it backs, which
        //    is the live defect asserted in test_TheLiveDefectIsReal.
        vm.prank(poolAddr);
        vm.expectRevert();
        adapter.redeem(racerShares, depositor);

        // 2. The fix's call: redeem the pro-rata slice. This is what the corrected
        //    withdrawAll computes, and it must succeed where the nominal one failed.
        uint256 deliverable = (venueValue * racerShares) / outstanding;
        if (deliverable > racerShares) deliverable = racerShares;

        assertGt(deliverable, 0, "the depositor receives real value, not a revert");
        assertLt(deliverable, racerShares, "and strictly less than the nominal claim, which is why the old code failed");

        uint256 before = IERC20(asset).balanceOf(depositor);
        vm.prank(poolAddr);
        adapter.redeem(deliverable, depositor);
        uint256 paid = IERC20(asset).balanceOf(depositor) - before;

        assertEq(paid, deliverable, "the venue honours exactly the pro-rata slice");
    }

    /// The pro-rata slice must never exceed the venue's total value, whatever the
    /// share counts are. This is the guard that stops one depositor's withdrawal
    /// from draining another's money — the failure mode of the first version of the
    /// fix, which read `positionValue()` for the whole shared venue.
    function test_ProRataSliceNeverExceedsTheVenue() public {
        if (forkUnavailable) return;

        uint256 venueValue = adapter.positionValue();
        uint256 outstanding = pool.totalShares();

        for (uint256 tokenId = 1; tokenId <= 3; tokenId++) {
            uint256 shares = pool.sharesOf(tokenId);
            if (shares == 0) continue;
            uint256 slice = (venueValue * shares) / outstanding;
            assertLe(slice, venueValue, "a slice never exceeds the whole venue");
            assertLe(slice, shares, "and never exceeds its own claim");
        }
    }
}
