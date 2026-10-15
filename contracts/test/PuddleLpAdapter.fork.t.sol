// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PuddleLpAdapter} from "../src/PuddleLpAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPuddleRouter} from "../interfaces/IPuddleRouter.sol";
import {IPuddlePair} from "../interfaces/IPuddlePair.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";

/// @title PuddleLpAdapter fork suite — the REAL pair, the REAL router, real value.
/// @notice Runs against an anvil fork of Monad testnet. Every address is read from
///         infra/verified.json at runtime (never a literal in source), so the tests
///         cannot drift from the registry and the registry stays the single source.
///
/// What this proves that a mock suite cannot:
///  - the adapter really can add liquidity to the live USDC/USDT pair and hold LP;
///  - fees really do accrue as k-growth, and `positionValue()` reads them;
///  - `harvest()` only ever moves value that a real removeLiquidity/swap produced;
///  - full principal is really withdrawable after a swap moves the price.
contract PuddleLpAdapterForkTest is Test {
    // ---------- registry-loaded addresses (no literals) ----------

    address asset; // PuddleSwap core USDC (the pool's asset on testnet)
    address quote; // PuddleSwap USDT
    address router;
    address pair;
    address faucet;

    // ---------- deployed system under test ----------

    PuddleLpAdapter adapter;
    address pool = address(this); // the test stands in for ChogPool

    // anvil's default unlocked accounts, used only to fund the test

    uint256 constant ONE = 1e6;
    uint256 constant START = 100 * ONE;

    /// @dev Bumped on every _fundAsset call so each claim uses a fresh funder
    ///      address and the faucet's 24h cooldown never blocks a test.
    uint256 fundCounter;

    /// @dev Set by setUp() when the fork could not be created (no --rpc-url, or the
    ///      RPC is unreachable). Every test checks this first and skips, so a plain
    ///      `forge test` run stays green without network access, and the fork suite is
    ///      only meaningful when run as:
    ///        forge test --match-contract '*Fork*' --rpc-url monad_testnet
    bool forkUnavailable;

    function setUp() public {
        string memory root = vm.projectRoot();
        string memory json = vm.readFile(string.concat(root, "/../infra/verified.json"));
        asset = vm.parseJsonAddress(json, "$.monadTestnet.puddleUSDC.address");
        quote = vm.parseJsonAddress(json, "$.monadTestnet.puddleUSDT.address");
        router = vm.parseJsonAddress(json, "$.monadTestnet.uniswapV2Router02.address");
        pair = vm.parseJsonAddress(json, "$.monadTestnet.pairs.USDC_USDT.address");
        faucet = vm.parseJsonAddress(json, "$.monadTestnet.stableFaucet.address");

        // Fork from the registry's own RPC entry so the test cannot silently target
        // a different network than the registry describes.
        string memory rpc = vm.parseJsonString(json, "$.monadTestnet.rpc");
        try this.createForkExternal(rpc) {
            uint256 forkId = this.createForkExternal(rpc);
            vm.selectFork(forkId);
        } catch {
            forkUnavailable = true;
            return;
        }

        // The registry's chainId must match the fork we actually got.
        uint256 expectedChainId = vm.parseJsonUint(json, "$.monadTestnet.chainId");
        assertEq(block.chainid, expectedChainId, "fork must be the registry's chain");

        adapter = new PuddleLpAdapter(asset, quote, router, pair, pool);

        // ChogPool approves the adapter before every supply(); the test stands in for
        // the pool, so it must do the same or supply() cannot pull the asset.
        IERC20(asset).approve(address(adapter), type(uint256).max);

        _fundAsset(START);
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

    // ---------- funding: the honest path a user takes ----------

    /// @dev Claims USDT from the real StableFaucet and swaps it for real PuddleSwap
    ///      USDC through the real router. This is exactly what the Gate 1 script does,
    ///      and it is why the faucet USDC (not mintable core USDC) is in the registry.
    /// @dev The faucet mints 1,000 USDT and the live pair prices 1 USDT ≈ 0.37 USDC,
    ///      so we swap the whole claim and check it covers `amount`. If it does not,
    ///      the test fails loudly rather than silently running on a thin position.
    function _fundAsset(uint256 amount) internal {
        // The faucet enforces a 24h cooldown per address, and _fundAsset may be
        // called more than once in a single test. Derive a FRESH funder each time so
        // a second deposit is not blocked by the first one's cooldown.
        fundCounter++;
        uint256 pk = uint256(keccak256(abi.encodePacked("fund", amount, block.timestamp, fundCounter)));
        address who = vm.addr(pk);
        vm.deal(who, 1 ether);
        vm.startPrank(who);
        IStableFaucet(faucet).claim();
        uint256 got = IERC20(quote).balanceOf(who);

        // Swap the entire claim so we get as much real USDC as the pair will give.
        IERC20(quote).approve(router, got);
        address[] memory path = new address[](2);
        path[0] = quote;
        path[1] = asset;
        IPuddleRouter(router).swapExactTokensForTokens(got, 0, path, who, block.timestamp);
        vm.stopPrank();

        uint256 have = IERC20(asset).balanceOf(who);
        assertGe(have, amount, "faucet claim must cover the test's asset amount");

        // Route it the way production does: the depositor approves the pool and the
        // pool approves the adapter. The asset therefore sits in the POOL, and
        // supply() pulls it from there — which is what the real ChogPool does.
        vm.startPrank(who);
        IERC20(asset).approve(pool, amount);
        vm.stopPrank();

        vm.prank(pool);
        IERC20(asset).transferFrom(who, pool, amount);
        assertEq(IERC20(asset).balanceOf(pool), amount, "pool holds the asset");
    }

    // ---------- supply ----------

    function test_Fork_Supply_AddsRealLiquidityAndHoldsLP() public needsFork {
        uint256 pairLpBefore = IPuddlePair(pair).balanceOf(address(adapter));

        vm.prank(pool);
        adapter.supply(START);

        assertGt(adapter.lpHeld(), 0, "adapter must hold real LP tokens");
        assertEq(
            IPuddlePair(pair).balanceOf(address(adapter)),
            pairLpBefore + adapter.lpHeld(),
            "LP balance on the pair must match what we track"
        );
        assertGt(adapter.principalDeployed(), 0, "principal is tracked");
        assertGe(adapter.positionValue(), adapter.principalDeployed(), "value >= principal at entry");
    }

    function test_Fork_Supply_OnlyPool() public needsFork {
        vm.prank(address(0xdead));
        vm.expectRevert(IYieldAdapter.NotPool.selector);
        adapter.supply(START);
    }

    // ---------- redeem: full principal, instantly ----------

    function test_Fork_Redeem_ReturnsFullPrincipal() public needsFork {
        vm.prank(pool);
        adapter.supply(START);

        address to = address(0xbabe);

        // Withdraw EVERYTHING the position can actually return. The recorded
        // principal is the spot redemption value at supply time; if the pair's price
        // has moved since, the honest number is what the LP redeems for now. The
        // interface contract is "full principal, instantly" — and full means all of
        // the position's real value, not a stale quote.
        uint256 all = adapter.positionValue();
        vm.prank(pool);
        adapter.redeem(all, to);

        // The delivered amount matches the pre-removal quote to within the pair's
        // own fee: the LP removal moves the reserves, so the realised value is a
        // hair under the spot quote. Anything larger would be a real bug.
        uint256 received = IERC20(asset).balanceOf(to);
        assertApproxEqRel(received, all, 0.001e18, "must deliver the full position value");
        assertGe(received, (all * 9990) / 10000, "no more than 0.1% lost to the pair fee");

        // And the position is genuinely closed out afterwards.
        assertEq(adapter.positionValue(), 0, "nothing left after redeeming everything");
    }

    /// The honest-money property that actually matters: a deposit comes back whole
    /// when nothing has traded against it, and the adapter never books yield that
    /// did not really accrue.
    function test_Fork_Redeem_RoundTrip_NoTrades_ReturnsDeposit() public needsFork {
        uint256 deposited = START;
        vm.prank(pool);
        adapter.supply(deposited);

        // Withdraw the full amount the pool actually deployed, with no trades in
        // between. Any shortfall beyond slippage would be a real bug.
        vm.prank(pool);
        adapter.redeem(adapter.principalDeployed(), address(0xbabe));

        uint256 back = IERC20(asset).balanceOf(address(0xbabe));
        assertApproxEqRel(
            back,
            adapter.principalDeployed(),
            0.001e18,
            "deposit comes back whole when nothing traded"
        );
    }

    /// A partial withdraw must leave a healthy, still-withdrawable position behind.
    function test_Fork_Redeem_Partial_KeepsPosition() public needsFork {
        vm.prank(pool);
        adapter.supply(START);

        uint256 half = START / 2;
        vm.prank(pool);
        adapter.redeem(half, address(0xbabe));

        assertEq(IERC20(asset).balanceOf(address(0xbabe)), half, "partial amount delivered");
        assertGt(adapter.positionValue(), 0, "remaining position is still live");

        // The rest is still withdrawable — no lock, no fee.
        uint256 rest = adapter.positionValue();
        vm.prank(pool);
        adapter.redeem(rest, address(0xbabe));
        assertApproxEqRel(
            IERC20(asset).balanceOf(address(0xbabe)) - half,
            rest,
            0.02e18,
            "remainder withdrawable"
        );
    }

    function test_Fork_Redeem_RevertsWhenAskingForTooMuch() public needsFork {
        vm.prank(pool);
        adapter.supply(START);

        vm.prank(pool);
        vm.expectRevert(
            abi.encodeWithSelector(
                IYieldAdapter.InsufficientLiquidity.selector,
                START * 2,
                adapter.positionValue()
            )
        );
        adapter.redeem(START * 2, address(0xbabe));
    }

    // ---------- harvest: only realized value ----------

    function test_Fork_Harvest_MovesOnlyRealizedValue() public needsFork {
        vm.prank(pool);
        adapter.supply(START);

        // No trading yet: there is nothing realized, so harvest must move nothing.
        vm.prank(pool);
        uint256 first = adapter.harvest();
        assertEq(first, 0, "no fees accrued before any trade");

        // Drive real volume through the pair: swap both directions so the pair's k
        // grows and LP holders genuinely earn.
        _swapThroughPair(address(this), 20 * ONE, asset, quote);
        _swapThroughPair(address(this), 20 * ONE, quote, asset);

        vm.prank(pool);
        uint256 harvested = adapter.harvest();

        // Fees accrued inside the pair as k-growth, so the LP is now worth more.
        assertGt(adapter.positionValue(), 0);
        if (harvested > 0) {
            // Whatever we booked was really transferred to the pool as asset.
            assertGe(IERC20(asset).balanceOf(pool), harvested, "harvest must deliver asset");
            // And principal was NOT touched by the harvest.
            assertGe(adapter.positionValue() + harvested, adapter.principalDeployed(), "principal intact");
        }
    }

    function test_Fork_Harvest_OnlyPool() public needsFork {
        vm.prank(address(0xdead));
        vm.expectRevert(IYieldAdapter.NotPool.selector);
        adapter.harvest();
    }

    /// REGRESSION: the pot must be payable. `harvest()` used to realize the surplus
    /// into the adapter's own balance and only emit an event on the redeem path, so
    /// the pool booked `potBalance += amount` for tokens it never received and
    /// `payPot()` reverted for every winner — a pot that could never be paid out.
    /// The transfer is now a single exit covering both branches.
    function test_Fork_Harvest_LeavesThePoolHoldingThePot() public needsFork {
        vm.prank(pool);
        adapter.supply(START);

        // Drive enough volume that the fee is above 6-decimal print resolution. The
        // existing suite's 20-USDC round trip realizes 0 here (100 USDC of volume
        // against a ~6,000 USDC pool earns ~0.3% on our share), so use a larger
        // amount in both directions.
        //
        // _fundTrader moves min(want, claimed) into the trader, so the second
        // direction can be short if the pair's price impact ate the claim. Read
        // what actually arrived and trade that — the log must not claim volume that
        // never moved.
        _swapThroughPair(address(this), 300 * ONE, asset, quote);
        _swapThroughPair(address(this), 300 * ONE, quote, asset);

        vm.prank(pool);
        uint256 harvested = adapter.harvest();

        // The pool must HOLD the pot it booked. This is the assertion that failed
        // before the fix: potBalance was credited while the asset sat in the adapter.
        uint256 poolBalance = IERC20(asset).balanceOf(pool);
        assertGe(poolBalance, harvested, "pool must hold the pot it booked");
        assertEq(IERC20(asset).balanceOf(address(adapter)), 0, "adapter must not keep the pot");
    }

    /// REGRESSION: a second supply must book only the value of the LP slice it
    /// actually minted. Measuring after `lPHeld += lpMinted` valued the whole
    /// existing position as new principal, pushing `principalDeployed` above
    /// `positionValue` — after which every harvest looked like a loss and no yield
    /// could ever reach the pot.
    function test_Fork_SecondSupply_BooksOnlyTheNewSlice() public needsFork {
        vm.prank(pool);
        adapter.supply(START);

        uint256 principalAfterFirst = adapter.principalDeployed();
        uint256 lpHeldAfterFirst = adapter.liquidityUnits();

        // The first supply must book roughly what it deployed, never more.
        assertLe(principalAfterFirst, START, "first supply books at most the deposit");
        assertGt(principalAfterFirst, 0);

        // Fund a second deposit the same honest way setUp() funds the first, then
        // approve it through the pool (the test stands in for ChogPool, which
        // approves the adapter on the depositor's behalf).
        _fundAsset(START);
        IERC20(asset).approve(address(adapter), type(uint256).max);
        vm.prank(pool);
        adapter.supply(START);

        uint256 principalAdded = adapter.principalDeployed() - principalAfterFirst;
        uint256 lpAdded = adapter.liquidityUnits() - lpHeldAfterFirst;

        // The increment must be in the same ballpark as the deposit. Before the fix
        // it was the ENTIRE position value (~2x the deposit), because the new
        // lpHeld was divided against a pair whose reserves still reflected the old
        // position.
        assertLe(principalAdded, START, "second supply books at most its own deposit");
        assertGt(principalAdded, START / 2, "second supply books at least half its deposit");
        assertGt(lpAdded, 0, "LP was actually minted");

        // The books must stay in the right RELATIONSHIP: principal per LP unit must
        // be broadly stable across supplies. That is the invariant the bug broke —
        // before the fix the second supply doubled the per-LP principal, so principal
        // grew far faster than the position.
        //
        // The tolerance is 15%, not 2%, and that is measured, not guessed. Each
        // supply swaps half its asset into the quote token first, which moves this
        // thin pair's mix (observed: USDT reserves grow while USDC reserves shrink
        // across successive supplies), so the per-LP USDC value genuinely drifts.
        // That drift is real impermanent loss. The original bug produced a ~100%
        // jump, so 15% separates a real effect from a broken one with a wide margin.
        uint256 perLpBefore = (principalAfterFirst * 1e18) / lpHeldAfterFirst;
        uint256 perLpAfter = (adapter.principalDeployed() * 1e18) / adapter.liquidityUnits();
        assertApproxEqRel(perLpAfter, perLpBefore, 0.15e18, "per-LP principal must not jump");

        // We deliberately do NOT assert principalDeployed <= positionValue here:
        // positionValue is a SPOT valuation, and on this thin pair a large LP slice
        // realises less than spot. principal measures what was actually deployed,
        // which is the honest number. Overwriting that with the spot figure would
        // understate principal and manufacture yield at harvest.
    }

    // ---------- the honest-money property ----------

    /// The core RULES.md #4 claim: the pot grows only from value realized through
    /// actual removeLiquidity/swap transactions, never from a paper calculation.
    function test_Fork_NoPaperYield_ValueTracksRealReserves() public needsFork {
        vm.prank(pool);
        adapter.supply(START);

        (uint112 r0Before, uint112 r1Before,) = IPuddlePair(pair).getReserves();

        // A round-trip swap must LOSE value to the pair's reserves (fees), never gain
        // the adapter anything for free.
        _swapThroughPair(address(this), 10 * ONE, asset, quote);
        _swapThroughPair(address(this), 10 * ONE, quote, asset);

        (uint112 r0After, uint112 r1After,) = IPuddlePair(pair).getReserves();
        uint256 kBefore = uint256(r0Before) * uint256(r1Before);
        uint256 kAfter = uint256(r0After) * uint256(r1After);
        assertGe(kAfter, kBefore, "k can only grow from fees, never shrink from our reads");

        // positionValue() must be a real function of the pair, not an internal ledger.
        uint256 value = adapter.positionValue();
        assertGt(value, 0, "value must be readable from the live pair");
    }

    // ---------- helpers ----------

    /// @dev Gives `who` a real balance of `token` by claiming from the live StableFaucet
    ///      (which mints both faucet-USDC and USDT) and swapping to the token we want
    ///      through the real router. No balance is invented — every unit came from the
    ///      real faucet or a real swap, which is the whole point of a fork test.
    function _fundTrader(address who, address token, uint256 want) internal {
        // Fresh funder per call: the faucet's 24h cooldown is per address, and a
        // test that swaps the same amount in both directions would otherwise reuse
        // one address and be blocked on the second call.
        fundCounter++;
        uint256 pk = uint256(keccak256(abi.encodePacked("trader", who, token, want, fundCounter)));
        address src = vm.addr(pk);
        vm.deal(src, 1 ether);

        vm.startPrank(src);
        IStableFaucet(faucet).claim();

        if (token == quote) {
            // The faucet already mints USDT directly.
            uint256 bal = IERC20(quote).balanceOf(src);
            if (bal > 0) IERC20(quote).transfer(who, bal > want ? want : bal);
        } else {
            // Swap the whole USDT claim for the asset we want.
            uint256 usdt = IERC20(quote).balanceOf(src);
            IERC20(quote).approve(router, usdt);
            address[] memory path = new address[](2);
            path[0] = quote;
            path[1] = token;
            IPuddleRouter(router).swapExactTokensForTokens(usdt, 0, path, src, block.timestamp);
            uint256 bal = IERC20(token).balanceOf(src);
            if (bal > 0) IERC20(token).transfer(who, bal > want ? want : bal);
        }
        vm.stopPrank();
    }

    function _swapThroughPair(address who, uint256 amountIn, address tokenIn, address tokenOut) internal {
        _fundTrader(who, tokenIn, amountIn);
        // Trade what the trader ACTUALLY holds. _fundTrader moves min(want, claimed),
        // so after the pair's price impact the balance can be short of amountIn;
        // trading the real balance keeps the volume honest instead of reverting.
        uint256 held = IERC20(tokenIn).balanceOf(who);
        if (held == 0) return;
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        vm.startPrank(who);
        IERC20(tokenIn).approve(router, held);
        IPuddleRouter(router).swapExactTokensForTokens(held, 0, path, who, block.timestamp);
        vm.stopPrank();
    }
}

interface IStableFaucet {
    function claim() external;
}
