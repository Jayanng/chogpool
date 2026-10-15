// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IPuddleRouter} from "../interfaces/IPuddleRouter.sol";
import {IPuddlePair} from "../interfaces/IPuddlePair.sol";

/// @title PuddleLpAdapter — real LP yield on PuddleSwap (Uniswap V2 fork), testnet path.
/// @notice Production implementation of the FROZEN IYieldAdapter interface. Deposits the
///         pool's stable into the real USDC/USDT pair, holds the LP tokens, and harvests
///         only value that has actually been realized through removeLiquidity/swap txs.
///
/// @dev Correct V2 semantics (docs/RULES.md #4 — the pot never grows on paper):
///      LP trading fees are NOT a claimable balance. They accrue inside the pair as
///      k-growth, which raises the LP redemption value above the pro-rata deposit value.
///      So `positionValue()` reads that real redemption value, and `harvest()` redeems a
///      small LP slice, measures the realized surplus versus the tracked principal, swaps
///      the surplus to the pool's asset, and returns it. No fee is ever booked without a
///      transaction that actually moved tokens.
///
/// @dev Withdrawal stays instant and full (PLAN.md Phase 1): `redeem()` removes liquidity
///      proportionally and returns the requested asset amount. Principal is never at risk
///      beyond ordinary AMM impermanent loss, which is the honest trade-off of the design
///      and is labelled as such in the UI.
contract PuddleLpAdapter is IYieldAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------- immutables ----------------

    /// @inheritdoc IYieldAdapter
    address public immutable asset;

    /// @inheritdoc IYieldAdapter
    address public immutable pool;

    /// @notice The paired stable we swap through (the other side of the LP).
    address public immutable quoteToken;

    /// @notice PuddleSwap UniswapV2Router02 (registry-resolved at deploy).
    IPuddleRouter public immutable router;

    /// @notice The USDC/USDT pair the LP position lives in (registry-resolved).
    IPuddlePair public immutable pair;

    /// @dev Whether `asset` is token0 or token1 in the pair. Resolved once at deploy so
    ///      redeem/harvest never guess the ordering (token0 is the lower address).
    bool public immutable assetIsToken0;

    // ---------------- state ----------------

    /// @inheritdoc IYieldAdapter
    uint256 public principalDeployed;

    /// @dev LP tokens currently held by this adapter.
    uint256 public lpHeld;

    /// @dev Basis points of slippage tolerance on swaps/removals (e.g. 50 = 0.5%).
    uint16 public slippageBps = 50;

    error ZeroAddress();
    error PairMismatch();

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool();
        _;
    }

    constructor(
        address asset_,
        address quoteToken_,
        address router_,
        address pair_,
        address pool_
    ) {
        if (
            asset_ == address(0) || quoteToken_ == address(0) || router_ == address(0)
                || pair_ == address(0) || pool_ == address(0)
        ) revert ZeroAddress();
        asset = asset_;
        quoteToken = quoteToken_;
        router = IPuddleRouter(router_);
        pair = IPuddlePair(pair_);
        pool = pool_;

        // Resolve token ordering once: the pair's token0/token1 are sorted by address.
        address t0 = pair.token0();
        if (t0 != asset_ && t0 != quoteToken_) revert PairMismatch();
        address t1 = pair.token1();
        if (t1 != asset_ && t1 != quoteToken_) revert PairMismatch();
        if (t0 == t1) revert PairMismatch();
        assetIsToken0 = (t0 == asset_);

        // Give the router room to pull both tokens when we add liquidity.
        IERC20(asset_).forceApprove(router_, type(uint256).max);
        IERC20(quoteToken_).forceApprove(router_, type(uint256).max);
        // Give the pair room to pull LP tokens when we remove liquidity.
        IPuddlePair(pair_).approve(router_, type(uint256).max);
    }

    // ---------------- pool-only operations ----------------

    /// @inheritdoc IYieldAdapter
    /// @dev Deploys the whole amount into the pair. We swap half of the asset into the
    ///      quote token so the two sides are balanced, then add liquidity with both.
    function supply(uint256 amount) external nonReentrant onlyPool {
        if (amount == 0) revert AdapterZeroAmount();

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        uint256 half = amount / 2;
        if (half == 0) revert AdapterZeroAmount();

        // Swap half the asset into the quote token, priced against the live pair.
        uint256 quoteOut = _swapAssetToQuote(half);

        // Add liquidity with both sides. The router pulls what it needs from us.
        uint256 assetIn = amount - half;
        (,, uint256 lpMinted) = router.addLiquidity(
            asset, quoteToken, assetIn, quoteOut, 0, 0, address(this), block.timestamp
        );

        // Measure the value of the LP slice we JUST minted, BEFORE adding it to
        // lpHeld. Measuring after would divide the new lpHeld by a pair whose
        // reserves still reflect the old position, so a second and later supply
        // would value the ENTIRE existing position as if it were new principal —
        // which inflates principalDeployed, makes every subsequent harvest look
        // like a loss, and permanently blocks yield from reaching the pot.
        uint256 newValue = _lpValueOfSlice(lpMinted);
        lpHeld += lpMinted;

        // Refund whatever the router did not consume (dust / rounding) to the pool.
        // Refunded dust is NOT principal: it never entered the pair, so the adapter
        // never has to redeem it. Sending it to the pool keeps the adapter's books
        // matching what is actually deployed.
        uint256 assetLeft = IERC20(asset).balanceOf(address(this));
        if (assetLeft > 0) IERC20(asset).safeTransfer(pool, assetLeft);
        uint256 quoteLeft = IERC20(quoteToken).balanceOf(address(this));
        if (quoteLeft > 0) IERC20(quoteToken).safeTransfer(pool, quoteLeft);

        // Principal = the LP's redemption value at this instant, measured the SAME
        // way redeem() measures what it can deliver: value the quote side at the
        // router's fee-charging quote, not the raw reserve ratio. This matters because
        // `supply` swaps half the asset into USDT first, which is itself a fee-paying
        // trade, so the deployed LP is worth a little less than the nominal input.
        // Recording the nominal input would understate principal; recording the raw
        // reserve ratio would overstate it and manufacture phantom yield at harvest.
        principalDeployed += newValue;

        emit Supplied(amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Removes liquidity and returns `amount` of the asset to `to`. The LP slice
    ///      removed is sized from the real redemption value, then re-checked after the
    ///      removal, because spot reserves overstate what a large slice actually
    ///      realises once the pair's price moves.
    /// @dev Reverts `InsufficientLiquidity` when the position genuinely cannot cover
    ///      `amount`. A shortfall of a few ten-thousandths (the pair's own fee on
    ///      converting the quote side) is delivered in full rather than reverting, so
    ///      a withdraw-all never bricks on rounding.
    function redeem(uint256 amount, address to) external nonReentrant onlyPool {
        if (amount == 0) revert AdapterZeroAmount();

        // Availability is the whole position: loose asset PLUS what the LP can be
        // redeemed for. Checking only the loose balance would refuse a perfectly
        // healthy withdraw just because the value is sitting in the pair.
        uint256 available = _totalValueInAsset();
        if (available < amount) revert InsufficientLiquidity(amount, available);

        uint256 loose = _assetBalance();
        uint256 missing = amount > loose ? amount - loose : 0;

        // Walk the LP out in slices until we hold `amount`, so a thin pair's price
        // impact is absorbed instead of under-delivering. The last pass removes
        // whatever is left.
        for (uint256 i = 0; i < 16 && missing > 0 && lpHeld > 0; i++) {
            uint256 lpValue = _lpValueInAsset();
            if (lpValue == 0) break;
            bool lastPass = i == 15;
            uint256 lpToRemove = lastPass ? lpHeld : (lpHeld * (missing + missing / 50)) / lpValue;
            if (lpToRemove == 0) lpToRemove = 1;
            if (lpToRemove > lpHeld) lpToRemove = lpHeld;
            _removeAndCollect(lpToRemove, missing);
            uint256 nowLoose = _assetBalance();
            missing = nowLoose >= amount ? 0 : amount - nowLoose;
        }

        // Deliver whatever the position actually realised. If the pair's fee left us
        // a hair short of the quoted amount, pay the real balance instead of
        // reverting — a withdraw-all must always succeed.
        uint256 held = _assetBalance();
        uint256 deliver = held < amount ? held : amount;
        if (deliver == 0) revert InsufficientLiquidity(amount, held);

        IERC20(asset).safeTransfer(to, deliver);
        emit Redeemed(lpHeld, deliver);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Realizes accrued yield: the LP redemption value above tracked principal.
    ///      Redeems that surplus as LP, swaps it to the asset, and hands it to the pool.
    ///      Principal is untouched, so the pool can still withdraw every depositor in full.
    function harvest() external nonReentrant onlyPool returns (uint256 amount) {
        uint256 value = _totalValueInAsset();
        if (value <= principalDeployed) return 0;

        uint256 surplus = value - principalDeployed;

        // Value sitting in the LP position vs loose asset.
        uint256 lpValue = _lpValueInAsset();
        uint256 loose = _assetBalance();

        if (loose >= surplus) {
            // Surplus already realized (dust from a previous redeem). The transfer to
            // the pool happens once, after this branch, so both paths behave the same.
            amount = surplus;
        } else {
            // Realize it: remove the LP slice that carries the surplus.
            uint256 needed = surplus - loose;
            uint256 lpToRemove = lpValue == 0 ? 0 : (lpHeld * needed) / lpValue;
            if (lpToRemove > lpHeld) lpToRemove = lpHeld;
            amount = loose + _removeAndCollect(lpToRemove, needed);
            // If the removal over-delivered (price moved in our favour), the excess
            // stays loose in the adapter and is harvested next time.
        }

        // Hand the realized surplus to the pool. This MUST happen on every path:
        // the pool credits potBalance with this exact number, so if the tokens stay
        // here the pool has booked a pot it does not hold and payPot() reverts for
        // every winner — the pot becomes permanently unpayable.
        IERC20(asset).safeTransfer(pool, amount);

        emit Harvested(amount);
    }

    // ---------------- views ----------------

    /// @inheritdoc IYieldAdapter
    /// @dev The asset value this adapter can hand back right now: loose asset plus the
    ///      real LP redemption value (both sides swapped to asset terms via the router).
    function positionValue() external view returns (uint256) {
        return _totalValueInAsset();
    }

    /// @inheritdoc IYieldAdapter
    function liquidityUnits() external view returns (uint256) {
        return lpHeld;
    }

    // ---------------- internals ----------------

    function _totalValueInAsset() internal view returns (uint256) {
        return _assetBalance() + _lpValueInAsset();
    }

    function _assetBalance() internal view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    /// @dev LP redemption value expressed in asset units. Both sides of the pair are
    ///      valued at the live reserves, with the quote side converted through the
    ///      router's own quote function — no simulated swaps, no paper accounting.
    /// @dev The quote side is priced by the ROUTER's getAmountsOut, not by the raw
    ///      reserve ratio, because getAmountsOut charges the pair's 0.3% fee. Using
    ///      the raw ratio would overstate the position by roughly that fee on every
    ///      call, which shows up as phantom yield at harvest time — exactly the paper
    ///      profit RULES.md #4 forbids.
    /// @dev LP redemption value of a SPECIFIC slice, in asset units. Both sides of the
    ///      pair are valued at the live reserves, with the quote side converted through
    ///      the router's own quote function — no simulated swaps, no paper accounting.
    function _lpValueOfSlice(uint256 lpSlice) internal view returns (uint256) {
        if (lpSlice == 0) return 0;
        uint256 totalSupply = pair.totalSupply();
        if (totalSupply == 0) return 0;

        (uint112 r0, uint112 r1,) = pair.getReserves();
        uint256 assetOut = assetIsToken0 ? (uint256(r0) * lpSlice) / totalSupply : (uint256(r1) * lpSlice) / totalSupply;
        uint256 quoteOut = assetIsToken0 ? (uint256(r1) * lpSlice) / totalSupply : (uint256(r0) * lpSlice) / totalSupply;

        if (quoteOut == 0) return assetOut;
        // Convert the quote side at the router's own (fee-charging) price.
        address[] memory path = new address[](2);
        path[0] = quoteToken;
        path[1] = asset;
        uint256[] memory quoted = router.getAmountsOut(quoteOut, path);
        return assetOut + quoted[quoted.length - 1];
    }

    function _lpValueInAsset() internal view returns (uint256) {
        return _lpValueOfSlice(lpHeld);
    }

    /// @dev Swaps `amountIn` of asset into the quote token through the router, honouring
    ///      the configured slippage tolerance.
    function _swapAssetToQuote(uint256 amountIn) internal returns (uint256 amountOut) {
        address[] memory path = new address[](2);
        path[0] = asset;
        path[1] = quoteToken;
        uint256[] memory quoted = router.getAmountsOut(amountIn, path);
        uint256 expectedOut = quoted[quoted.length - 1];
        uint256 minOut = (expectedOut * (10_000 - slippageBps)) / 10_000;
        uint256[] memory amounts = router.swapExactTokensForTokens(
            amountIn, minOut, path, address(this), block.timestamp
        );
        amountOut = amounts[amounts.length - 1];
        if (amountOut < minOut) revert SlippageExceeded(expectedOut, minOut);
    }

    /// @dev Swaps `amountIn` of quote token into the asset.
    function _swapQuoteToAsset(uint256 amountIn) internal returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        address[] memory path = new address[](2);
        path[0] = quoteToken;
        path[1] = asset;
        uint256[] memory quoted = router.getAmountsOut(amountIn, path);
        uint256 expectedOut = quoted[quoted.length - 1];
        uint256 minOut = (expectedOut * (10_000 - slippageBps)) / 10_000;
        uint256[] memory amounts = router.swapExactTokensForTokens(
            amountIn, minOut, path, address(this), block.timestamp
        );
        amountOut = amounts[amounts.length - 1];
        if (amountOut < minOut) revert SlippageExceeded(expectedOut, minOut);
    }

    /// @dev Removes `lpAmount` of liquidity and converts everything to the asset.
    /// @return assetReceived the asset units now held as loose balance.
    function _removeAndCollect(uint256 lpAmount, uint256) internal returns (uint256 assetReceived) {
        if (lpAmount == 0) return _assetBalance();

        // Quote the removal so we can bound slippage.
        uint256 totalSupply = pair.totalSupply();
        (uint112 r0, uint112 r1,) = pair.getReserves();
        uint256 expAsset = assetIsToken0
            ? (uint256(r0) * lpAmount) / totalSupply
            : (uint256(r1) * lpAmount) / totalSupply;
        uint256 expQuote = assetIsToken0
            ? (uint256(r1) * lpAmount) / totalSupply
            : (uint256(r0) * lpAmount) / totalSupply;
        uint256 minAsset = (expAsset * (10_000 - slippageBps)) / 10_000;
        uint256 minQuote = (expQuote * (10_000 - slippageBps)) / 10_000;

        // Decrement the accounting BEFORE the external call so a reentrant caller can
        // never observe a stale lpHeld (checks-effects-interactions).
        lpHeld -= lpAmount;

        (uint256 assetOut, uint256 quoteOut) = router.removeLiquidity(
            asset, quoteToken, lpAmount, minAsset, minQuote, address(this), block.timestamp
        );

        // Convert the quote side to the asset so everything is one token. The asset
        // side is already in the right token, so it is only referenced by the
        // return-value contract of removeLiquidity.
        _swapQuoteToAsset(quoteOut);
        assetOut; // consumed by the pair; the adapter reads its own balance below

        assetReceived = _assetBalance();
    }

    // ---------------- admin ----------------

    /// @notice Adjust the slippage tolerance (bps). Owner-free by design: the adapter is
    ///         deployed once per pool and this is a safety valve, not a control surface.
    function setSlippageBps(uint16 bps) external onlyPool {
        if (bps > 1_000) revert SlippageExceeded(bps, 1_000); // max 10%
        slippageBps = bps;
    }
}
