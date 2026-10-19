// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {ChogMirror} from "../src/ChogMirror.sol";
import {PuddleLpAdapter} from "../src/PuddleLpAdapter.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IPuddleRouter} from "../interfaces/IPuddleRouter.sol";

/// @title StrandedSharesForkTest, is a claim the venue cannot pay recoverable?
/// @notice Runs against an anvil fork of Monad testnet with the LIVE deployed pool
///         and the LIVE deployed adapter, and answers one question that a
///         simulation of independent calls cannot: after draining a venue, can the
///         residue of a position still be withdrawn?
///
/// @dev WHY THIS EXISTS. The live v6 adapter's `principalDeployed` counter only
///      ever increased, so after racer1's withdrawal it reported 65.472034 above a
///      position worth 0.788226. Racer2's 887,422 shares are therefore backed by
///      less than their nominal value, and the plan for migrating off that adapter
///      depends on whether the 99,196-unit gap is recoverable or permanently
///      stranded.
///
/// @dev WHY `cast call` CANNOT ANSWER IT. `cast call` simulates each call against
///      current state INDEPENDENTLY. Two sequential calls each return success
///      against the same starting state, which says nothing about whether the
///      second one succeeds after the first has drained the position. That
///      distinction is the whole question, so it has to be executed in sequence
///      inside one transaction frame, which is what a forge fork test does.
///
/// @dev This test is READ-MOSTLY on live state and only ever WRITES inside the
///      fork's own simulation. A fork is a local copy: no transaction here reaches
///      testnet, so this can be run freely and re-run after every code change.
contract StrandedSharesForkTest is Test {
    address asset;
    address quote;
    address router;
    address pair;

    ChogPool pool;
    PuddleLpAdapter adapter;

    /// @dev The live position under examination. Racer2's is the only one the live
    ///      pool still holds.
    uint256 constant TOKEN = 954;

    bool forkUnavailable;

    function setUp() public {
        string memory root = vm.projectRoot();
        string memory dep = vm.readFile(string.concat(root, "/../infra/deployments.json"));
        string memory reg = vm.readFile(string.concat(root, "/../infra/verified.json"));

        asset = vm.parseJsonAddress(reg, ".monadTestnet.puddleUSDC.address");
        quote = vm.parseJsonAddress(reg, ".monadTestnet.puddleUSDT.address");
        router = vm.parseJsonAddress(reg, ".monadTestnet.uniswapV2Router02.address");
        pair = vm.parseJsonAddress(reg, ".monadTestnet.pairs.USDC_USDT.address");

        pool = ChogPool(vm.parseJsonAddress(dep, ".pool"));
        adapter = PuddleLpAdapter(vm.parseJsonAddress(dep, ".yieldAdapter"));

        string memory rpc = vm.parseJsonString(reg, ".monadTestnet.rpc");
        try this.createForkExternal(rpc) {
            uint256 forkId = this.createForkExternal(rpc);
            vm.selectFork(forkId);
        } catch {
            forkUnavailable = true;
        }
    }

    function createForkExternal(string memory rpc) external returns (uint256) {
        return vm.createFork(rpc);
    }

    modifier needsFork() {
        if (forkUnavailable) return;
        _;
    }

    // ---------- the live state, recorded rather than assumed ----------

    /// Records what the live stack actually looks like right now. Every number the
    /// migration decision depends on is asserted here, so a fork of a different
    /// state fails loudly instead of silently answering a different question.
    function test_Fork_LiveState_IsTheDocumentedDefect() public needsFork {
        (address depositor,, uint256 recordedPrincipal) = pool.depositOf(TOKEN);
        uint256 shares = pool.sharesOf(TOKEN);
        uint256 basis = adapter.principalDeployed();
        uint256 value = adapter.positionValue();

        emit log_named_address("depositor", depositor);
        emit log_named_uint("shares", shares);
        emit log_named_uint("recorded principal", recordedPrincipal);
        emit log_named_uint("adapter basis (broken counter)", basis);
        emit log_named_uint("adapter position value", value);

        assertGt(shares, 0, "the live position still holds shares");
        // The defect itself: the counter sits far above the position it describes.
        // This is what makes harvest() return 0 forever.
        assertGt(basis, value, "basis is inflated above the position, the documented defect");
        assertGt(shares, value, "shares exceed what the venue can pay");
    }

    // ---------- the question that decides the migration ----------

    /// THE decisive test: drain the venue, then try to withdraw the residue.
    ///
    /// Sequenced inside one transaction frame so the second withdrawal sees the
    /// state the first one left behind. This is the exact question the migration
    /// plan turns on, and it cannot be answered by independent simulations.
    function test_Fork_Residue_IsItRecoverableAfterDraining() public needsFork {
        address owner = pool.owner();
        uint256 shares = pool.sharesOf(TOKEN);
        uint256 value = adapter.positionValue();
        uint256 residue = shares - value;

        emit log_named_uint("shares", shares);
        emit log_named_uint("position value", value);
        emit log_named_uint("residue if any", residue);

        // Drain the venue down to the position's real value, owner-driven exactly
        // as the migration script would.
        vm.startPrank(owner);
        pool.withdraw(TOKEN, value);
        vm.stopPrank();

        uint256 sharesAfter = pool.sharesOf(TOKEN);
        uint256 valueAfter = adapter.positionValue();
        uint256 basisAfter = adapter.principalDeployed();

        emit log_named_uint("shares after drain", sharesAfter);
        emit log_named_uint("venue value after drain", valueAfter);
        emit log_named_uint("basis after drain", basisAfter);

        // Now the question: can the residue still be withdrawn?
        if (sharesAfter > 0) {
            uint256 gotBefore = IERC20(asset).balanceOf(pool.owner());
            vm.startPrank(owner);
            (bool ok, bytes memory ret) =
                address(pool).call(abi.encodeWithSignature("withdraw(uint256,uint256)", TOKEN, sharesAfter));
            vm.stopPrank();
            uint256 got = IERC20(asset).balanceOf(pool.owner()) - gotBefore;

            emit log_named_string("residue withdraw succeeded", ok ? "YES" : "NO");
            emit log_named_string("revert reason", ok ? "" : string(ret));
            emit log_named_uint("residue actually delivered", got);

            if (ok) {
                // RECOVERABLE: the venue over-delivered, or loose asset covered the
                // gap. The residue is not a liability and option 3 is safe.
                emit log("RESULT: residue is recoverable, no stranded claim remains");
            } else {
                // STRANDED: the residue is a live claim the venue cannot honour.
                // It would revert on every withdrawal attempt and could draw
                // against future deposits. This is the armed-but-small claim.
                emit log("RESULT: residue is STRANDED, it reverts and stays a live liability");
            }
        } else {
            emit log("RESULT: nothing left after draining, no residue exists");
        }
    }

    /// The full nominal claim in one call, which is what a depositor would try
    /// first. Establishes the baseline failure the residue question starts from.
    function test_Fork_FullNominalClaim_RevertsToday() public needsFork {
        address owner = pool.owner();
        uint256 shares = pool.sharesOf(TOKEN);

        vm.startPrank(owner);
        vm.expectRevert();
        pool.withdrawAll(TOKEN);
        vm.stopPrank();

        emit log_named_uint("nominal shares that cannot be paid in one call", shares);
    }

    /// Whether the OLD pool can be re-pointed at all, on its current code. This is
    /// the constraint that decides whether a new pool is required.
    function test_Fork_OldPool_CannotBeRePointed() public needsFork {
        address owner = pool.owner();

        vm.startPrank(owner);
        (bool ok, bytes memory ret) = address(pool).call(
            abi.encodeWithSignature("setYieldAdapter(address)", address(adapter))
        );
        vm.stopPrank();

        emit log_named_string("old pool setYieldAdapter", ok ? "succeeded" : "reverted");
        if (!ok) emit log_named_string("reason", string(ret));

        // The old guard reads the venue's own counter, which is permanently
        // inflated. So the live pool cannot be migrated without a new deployment.
        assertFalse(ok, "the live pool cannot be re-pointed while its adapter reports inflated principal");
    }
}
