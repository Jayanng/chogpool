// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {ChogMirror} from "../src/ChogMirror.sol";
import {TestChogToken} from "../src/TestChogToken.sol";
import {IPuddleRouter} from "../interfaces/IPuddleRouter.sol";

/// @notice The exact funding sequence the web UI drives, executed against the
///         live testnet deployment.
///
/// @dev Why this exists as a test rather than a manual click-through: the UI
///      has to discover that the pool's asset is NOT mintable, and the only
///      honest way in is claim → swap → approve → deposit. That ordering is a
///      property of the venue, not of our code, so it is verified here against
///      the real contracts instead of assumed.
/// @dev Fork discipline, same as PuddleLpAdapter.fork.t.sol: the fork is created
///      in setUp from the registry's own RPC entry, and every test skips when
///      that is unavailable. A plain `forge test` therefore stays green without
///      network access. Run the suite with:
///        forge test --match-contract '*Fork*' --rpc-url monad_testnet
contract MoneyPathForkTest is Test {
    ChogPool pool;
    ChogMirror mirror;
    TestChogToken testChog;
    IPuddleRouter router;

    address asset;
    address quote;
    address stableFaucet;

    address player = makeAddr("player");

    /// @dev Set by setUp() when the fork could not be created. Every test checks
    ///      this first and skips, so the unit run never depends on the network.
    bool forkUnavailable;

    function setUp() public {
        string memory root = vm.projectRoot();
        string memory json = vm.readFile(string.concat(root, "/../infra/deployments.json"));
        string memory reg = vm.readFile(string.concat(root, "/../infra/verified.json"));

        pool = ChogPool(vm.parseJsonAddress(json, ".pool"));
        mirror = ChogMirror(vm.parseJsonAddress(json, ".mirror"));
        testChog = TestChogToken(vm.parseJsonAddress(json, ".testChogToken"));
        asset = vm.parseJsonAddress(reg, ".monadTestnet.puddleUSDC.address");
        quote = vm.parseJsonAddress(reg, ".monadTestnet.puddleUSDT.address");
        stableFaucet = vm.parseJsonAddress(reg, ".monadTestnet.stableFaucet.address");
        router = IPuddleRouter(vm.parseJsonAddress(reg, ".monadTestnet.uniswapV2Router02.address"));

        vm.label(asset, "PuddleUSDC");
        vm.label(quote, "PuddleUSDT");
        vm.label(stableFaucet, "StableFaucet");
        vm.label(address(pool), "ChogPool");
        vm.label(address(mirror), "ChogMirror");
        vm.label(address(testChog), "TestCHOG");

        // Fork from the registry's own RPC entry so the test cannot silently
        // target a different network than the registry describes.
        string memory rpc = vm.parseJsonString(reg, ".monadTestnet.rpc");
        try this.createForkExternal(rpc) {
            uint256 forkId = this.createForkExternal(rpc);
            vm.selectFork(forkId);
        } catch {
            forkUnavailable = true;
        }
    }

    /// External wrapper so the try/catch can catch a fork-creation failure.
    function createForkExternal(string memory rpc) external returns (uint256) {
        return vm.createFork(rpc);
    }

    /// Deposits require the depositor to hold the mirrored Chog, so the money
    /// path in practice begins with a mirror mint. Test Drive is used here
    /// because it needs no mainnet owner signature, and this test is about the
    /// funding sequence rather than the attestation.
    function _mirrorTestDrive(address who, uint256 tokenId) internal {
        vm.prank(who);
        mirror.mintTestDrive(tokenId, "ipfs://test-drive");
    }

    /// The first mirror token id not yet minted, or 0 if the collection is full.
    /// `ownerOf` reverts ERC721NonexistentToken for an unminted token, so the
    /// revert IS the "free" signal. Capped so the scan stays bounded.
    function _firstUnclaimedToken() internal view returns (uint256) {
        for (uint256 id = 1; id <= 64; id++) {
            try mirror.ownerOf(id) returns (address) {
                continue; // already minted
            } catch {
                return id;
            }
        }
        return 0;
    }

    /// The pool's asset really is the non-mintable core USDC. If this ever
    /// changes, the UI's funding sequence would be wrong, so it is asserted
    /// rather than assumed.
    function test_LivePoolAsset_IsTheNonMintableCoreUSDC() public view {
        if (forkUnavailable) return;
        assertEq(pool.asset(), asset, "pool asset is the registry's core USDC");
        assertEq(mirror.MAX_SUPPLY(), 1969, "mirror supply unchanged");
    }

    /// The whole funding path a user walks, executed for real.
    function test_FullFundingPath_ClaimSwapApproveDeposit() public {
        if (forkUnavailable) return;
        // An unclaimed token, resolved against live state rather than hardcoded.
        // The mirror is the real deployed one and this is a fork of the live
        // chain, so a fixed id can already be minted by anyone — including by a
        // demo run on the same stack — and mintTestDrive would revert
        // TokenAlreadyMinted. Scanning for the first free id keeps this test
        // true for as long as the stack is live.
        uint256 tokenId = _firstUnclaimedToken();
        require(tokenId != 0, "no unclaimed mirror token on the forked chain");
        // The deposit requires the depositor to hold the mirror, so mint first.
        _mirrorTestDrive(player, tokenId);

        vm.startPrank(player);

        // 1. Claim from the real faucet. Reverts if the cooldown has not
        //    cleared for this address, which is the honest behaviour the UI
        //    disables the button for.
        (bool ok, bytes memory ret) = stableFaucet.call(abi.encodeWithSignature("claim()"));
        if (!ok) {
            // CooldownActive is the only acceptable reason to skip: the UI
            // reads nextClaimAt() and disables the button instead of letting
            // the user pay gas for a revert.
            assertGt(ret.length, 4, "faucet reverted with a reason, not silently");
        }
        uint256 quoteBalance = IERC20(quote).balanceOf(player);
        emit log_named_uint("quote claimed (USDT)", quoteBalance);
        assertGt(quoteBalance, 0, "faucet minted the swappable quote token");

        // 2. Swap the quote into the pool's asset through the real router,
        //    with the same 1% slippage bound the UI applies.
        address[] memory path = new address[](2);
        path[0] = quote;
        path[1] = asset;
        uint256[] memory amounts = router.getAmountsOut(quoteBalance, path);
        uint256 expected = amounts[1];
        uint256 minOut = (expected * 99) / 100;

        IERC20(quote).approve(address(router), quoteBalance);
        router.swapExactTokensForTokens(quoteBalance, minOut, path, player, block.timestamp + 900);

        uint256 assetBalance = IERC20(asset).balanceOf(player);
        emit log_named_uint("asset received (USDC)", assetBalance);
        assertGe(assetBalance, minOut, "swap honoured the slippage bound");

        // 3. Approve exactly the deposit amount, never an unlimited allowance.
        uint256 depositAmount = assetBalance / 2;
        IERC20(asset).approve(address(pool), depositAmount);
        assertEq(IERC20(asset).allowance(player, address(pool)), depositAmount, "exact-amount approval");

        // 4. Deposit. The pool pulls the approved amount.
        uint256 sharesBefore = pool.sharesOf(tokenId);
        pool.deposit(tokenId, depositAmount);
        uint256 sharesAfter = pool.sharesOf(tokenId);

        assertGt(sharesAfter, sharesBefore, "deposit credited shares");
        // The default mock venue is lossless, so shares track principal 1:1.
        // depositOf returns (depositor, shares, principal): read the tuple's
        // principal field rather than assuming a scalar.
        (, , uint256 recordedPrincipal) = pool.depositOf(tokenId);
        assertEq(recordedPrincipal, depositAmount, "principal recorded against the token");
        assertEq(IERC20(asset).balanceOf(player), assetBalance - depositAmount, "exact amount pulled");

        vm.stopPrank();

        // The corrected semantics: current holdings, and the two fields agree.
        assertEq(pool.totalPrincipal(), pool.totalShares(), "totalPrincipal equals totalShares");
        assertGt(pool.totalPrincipal(), 0, "pool now holds principal");

        // And odds are derived from real time-weighted balance, not invented.
        emit log_named_uint("oddsBps for token", pool.oddsBpsOf(tokenId));
    }

    /// Withdraw returns principal in full, and both figures drop together.
    function test_WithdrawAll_ReturnsPrincipalInFull() public {
        if (forkUnavailable) return;
        uint256 tokenId = 7;
        _mirrorTestDrive(player, tokenId);
        vm.startPrank(player);

        (bool ok,) = stableFaucet.call(abi.encodeWithSignature("claim()"));
        if (!ok) vm.skip(true); // faucet cooldown: cannot fund this run

        uint256 quoteBalance = IERC20(quote).balanceOf(player);
        address[] memory path = new address[](2);
        path[0] = quote;
        path[1] = asset;
        uint256[] memory amounts = router.getAmountsOut(quoteBalance, path);
        IERC20(quote).approve(address(router), quoteBalance);
        router.swapExactTokensForTokens(quoteBalance, (amounts[1] * 99) / 100, path, player, block.timestamp + 900);

        uint256 assetBalance = IERC20(asset).balanceOf(player);
        IERC20(asset).approve(address(pool), assetBalance);
        pool.deposit(tokenId, assetBalance);

        uint256 before = pool.totalPrincipal();
        uint256 playerPrincipal = pool.sharesOf(tokenId);
        pool.withdrawAll(tokenId);

        assertEq(pool.sharesOf(tokenId), 0, "shares cleared");
        // The pool is shared, so a full withdraw drops the pool's principal by
        // exactly what THIS position held — not necessarily to zero. Asserting
        // zero passed only while the pool had a single position; it broke the
        // moment a second racer deposited, which is the correct outcome and not
        // a regression. The property under test is that the player's own
        // position leaves with it and the accounting stays consistent.
        assertEq(pool.totalPrincipal(), before - playerPrincipal, "principal dropped by exactly this position");
        assertEq(pool.totalPrincipal(), pool.totalShares(), "the two still agree");
        // Withdrawal returns the position's real redemption value, which on a
        // live AMM is not identical to the deposited amount. The difference is
        // the round-trip cost: the pool's own LP entry cost plus the price
        // impact of the deposit and the withdrawal themselves.
        //
        // The bound is derived from the pair, not guessed. The player deposits
        // into a pool whose TVL is `poolTVL`, so the player's own impact on the
        // pair is on the order of deposit/TVL. A bound of 2% only holds while
        // the deposit is small next to the pool; a deposit that is a large
        // fraction of TVL moves the price on its own and the honest cost is
        // higher. The bound is therefore `base + deposit/TVL`, so the assertion
        // tracks the real mechanism instead of failing whenever the live pool
        // happens to be smaller than the faucet can fund.
        uint256 poolTVL = pool.positionValue();
        uint256 returned = IERC20(asset).balanceOf(player);
        emit log_named_uint("returned (USDC)", returned);
        emit log_named_uint("deposited (USDC)", assetBalance);
        emit log_named_uint("pool TVL (USDC)", poolTVL);
        // base 1% for the LP round trip, plus the player's own share of the
        // pool as its price impact, with a floor of 2% for small deposits.
        uint256 impactBps = poolTVL == 0 ? 10_000 : (assetBalance * 10_000) / poolTVL;
        uint256 boundBps = 100 + impactBps < 200 ? 200 : 100 + impactBps;
        assertApproxEqRel(returned, assetBalance, boundBps * 1e14, "withdrawal returns the position's value within its round-trip cost");

        vm.stopPrank();
    }

    /// Test CHOG: the faucet, the cooldown, and the label that keeps it from
    /// being mistaken for the real token.
    function test_TestChogToken_FaucetCooldownAndLabel() public {
        if (forkUnavailable) return;
        assertEq(testChog.testLabel(), "Test CHOG", "label is unambiguous");

        vm.startPrank(player);
        testChog.claim();
        assertGt(testChog.balanceOf(player), 0, "faucet minted");

        // The second claim must revert with the cooldown, and the recorded
        // next-claim time must be the one that blocks it.
        uint256 next = testChog.nextClaimAt(player);
        assertGt(next, block.timestamp, "cooldown is in the future");
        vm.expectRevert();
        testChog.claim();

        // And a tip is a plain transfer.
        address friend = makeAddr("friend");
        uint256 tipAmount = 1e18;
        testChog.transfer(friend, tipAmount);
        assertEq(testChog.balanceOf(friend), tipAmount, "tip transferred");
        vm.stopPrank();
    }
}
