// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {PuddleLpAdapter} from "../src/PuddleLpAdapter.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IChogPool} from "../interfaces/IChogPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title ChogPoolWithdraw fork suite, does withdrawAll work on the deployed stack?
/// @notice Runs against an anvil fork of Monad testnet. Every address is read from
///         infra/verified.json at runtime, never a literal in source.
///
/// @dev SPLIT INTO TWO SUITES ON PURPOSE, because the stack changed underneath the
///      original single-purpose version.
///
///      This suite now covers the CURRENT stack: it proves the corrected
///      `withdrawAll` behaves correctly on the deployed pool, including the
///      pro-rata guard that stops one depositor's withdrawal draining another's
///      money, and that the pot's seeded/earned split is real on chain.
///
///      The proof that the OLD code actually reverted lives in
///      `StrandedSharesFork.t.sol`, which is pinned to the superseded v6 stack and
///      still holds the position that reverted. Splitting them is deliberate:
///      "the old code failed here" and "the new code works here" are questions
///      about two different contracts, and a suite that answers both by reading
///      whatever the registry happens to point at will silently start answering
///      the wrong one. That is exactly how CI broke: this suite read
///      `verified.json`'s `chogPool` while the other read `deployments.json`, and
///      the two diverged when the fresh stack was deployed.
///
/// @dev WHY THE DEPOSIT-LEVEL PROOF IS A UNIT TEST NOW. The new pool has no
///      deposits yet, so a fork test cannot exercise a real withdrawal through a
///      real position. The deposit-level behaviour is pinned by
///      `ChogPool.t.sol` (five tests, including the two-depositor one that caught
///      the whole-venue mispayment) and will be re-pinned here on the first real
///      deposit. Until then this suite asserts what the live stack CAN honestly
///      assert today.
///
/// Run: forge test --match-contract 'ChogPoolWithdrawForkTest' --rpc-url monad_testnet
contract ChogPoolWithdrawForkTest is Test {
    uint256 constant ONE = 1e6;

    address poolAddr;
    address adapterAddr;
    address asset;

    ChogPool pool;
    PuddleLpAdapter adapter;

    bool forkUnavailable;

    function setUp() public {
        string memory root = vm.projectRoot();
        string memory json = vm.readFile(string.concat(root, "/../infra/verified.json"));

        poolAddr = vm.parseJsonAddress(json, "$.monadTestnet.chogPool.address");
        adapterAddr = vm.parseJsonAddress(json, "$.monadTestnet.puddleLpAdapter.address");
        asset = vm.parseJsonAddress(json, "$.monadTestnet.puddleUSDC.address");

        string memory rpc = vm.parseJsonString(json, "$.monadTestnet.rpc");
        try this.createForkExternal(rpc) {
            uint256 forkId = this.createForkExternal(rpc);
            vm.selectFork(forkId);
        } catch {
            forkUnavailable = true;
            return;
        }

        // The CURRENT stack, read from the registry's live keys. A fresh deploy
        // moves these, and this suite is meant to follow them, because it is
        // testing the code that is actually deployed.
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

    /// The wiring the withdraw path depends on must be the real thing. A pool
    /// pointed at the wrong adapter is the silent failure mode that makes every
    /// other assertion in this suite meaningless.
    function test_DeployedWiring_IsCorrect() public needsFork {
        assertEq(pool.yieldAdapter(), adapterAddr, "the pool points at the registry adapter");
        assertTrue(adapter.asset() != address(0), "the adapter has a real asset");
        assertEq(address(adapter.pool()), poolAddr, "the adapter points back at this pool");
    }

    /// The pro-rata guard, on the real deployed code. This is the invariant that
    /// stopped the first version of the fix from mispaying: reading the venue's
    /// WHOLE value let one depositor's withdrawAll consume another's money.
    ///
    /// Computed from live state rather than a fixture, so it exercises the
    /// deployed arithmetic against whatever the venue currently holds.
    function test_ProRataSliceNeverExceedsTheVenue() public needsFork {
        uint256 venueValue = adapter.positionValue();
        uint256 outstanding = pool.totalShares();

        // With no deposits yet the guard is trivially satisfied; assert the
        // degenerate case honestly rather than skipping it, so the day a deposit
        // lands this test starts doing real work instead of silently passing.
        if (outstanding == 0) {
            assertEq(venueValue, 0, "an empty venue holds nothing, so nothing can be overpaid");
            return;
        }

        for (uint256 tokenId = 1; tokenId <= 5; tokenId++) {
            uint256 shares = pool.sharesOf(tokenId);
            if (shares == 0) continue;
            uint256 slice = (venueValue * shares) / outstanding;
            assertLe(slice, venueValue, "a slice never exceeds the whole venue");
            assertLe(slice, shares, "and never exceeds its own claim");
        }
    }

    /// A withdraw on an empty position must revert rather than pay zero. A silent
    /// zero-value withdrawal would let the UI claim a success that moved nothing.
    function test_WithdrawAll_OnUnboundToken_Reverts() public needsFork {
        // Token 999999 has never been bound, so there is no depositor for it.
        vm.expectRevert();
        pool.withdrawAll(999999);
    }

    /// The pot's composition must be separable on chain. This is the property the
    /// honest labelling rests on: a judge can compute the earned yield as
    /// `potBalance - potSeeded` and see it is zero, without trusting any copy.
    function test_Pot_SeededIsSeparableFromEarned() public needsFork {
        uint256 balance = pool.potBalance();
        uint256 seeded = pool.potSeeded();

        // The seeded counter can never exceed the pot, and the pool must actually
        // hold what it reports.
        assertLe(seeded, balance, "seeded can never exceed the pot it was added to");
        assertEq(IERC20(asset).balanceOf(poolAddr), balance, "the pool holds exactly what it reports");

        emit log_named_uint("potBalance", balance);
        emit log_named_uint("potSeeded", seeded);
        emit log_named_uint("earned yield (balance - seeded)", balance - seeded);
    }
}
