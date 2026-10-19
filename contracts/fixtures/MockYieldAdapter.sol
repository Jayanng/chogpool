// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";

/// @title MockYieldAdapter: DEV/TEST ONLY. Never imported by contracts/src.
/// @notice Stands in for a yield venue in tests. It holds the principal and lets a
///         test inject "yield" (as if LP fees or Aave interest had accrued), which is
///         what makes the harvest path testable without a live venue.
///
/// The pool's harvest() only moves asset that actually arrived in this contract, so
/// the mock can never manufacture a paper profit the way a fake-APY ticker would.
contract MockYieldAdapter is IYieldAdapter {
    using SafeERC20 for IERC20;

    address public immutable asset;
    address public immutable pool;

    /// @dev Principal the venue currently holds for the pool (asset units).
    uint256 public principal;

    /// @dev Entry cost in basis points, charged on every supply(). The real venue
    ///      charges a swap fee plus price impact when it converts half the deposit
    ///      before adding liquidity. A lossless mock would leave the pool's 1:1
    ///      share assumption untested, which is exactly the assumption that broke
    ///      withdraw-all against the live pair.
    uint256 public entryCostBps;

    error OnlyPool();

    constructor(address asset_, address pool_) {
        asset = asset_;
        pool = pool_;
    }

    /// @dev TEST ONLY: make supply() charge `bps` of entry cost, like a real venue.
    function setEntryCostBps(uint256 bps) external {
        entryCostBps = bps;
    }

    /// @dev TEST ONLY: simulate the venue's value drifting BELOW what it took in,
    ///      which is ordinary AMM behaviour and the state the old `withdrawAll`
    ///      could not survive. The real pair does this through trading; the mock
    ///      needs a way to reproduce it without a pair.
    function simulateDrift(uint256 amount) external {
        if (amount > principal) principal = 0;
        else principal -= amount;
        // The tokens leave the venue entirely, so positionValue() drops too.
        IERC20(asset).safeTransfer(msg.sender, amount);
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    /// @inheritdoc IYieldAdapter
    function supply(uint256 amount) external onlyPool {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        // Charge the entry cost by handing the difference back immediately, so the
        // venue's own balance, and therefore positionValue(), reflects what the
        // pool can actually redeem.
        uint256 cost = (amount * entryCostBps) / 10_000;
        if (cost > 0) IERC20(asset).safeTransfer(msg.sender, cost);
        principal += amount - cost;
        emit Supplied(amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev TEST ONLY. Mirrors the REAL adapter's semantics: principal is the cost
    ///      basis that is RELEASED when value leaves the venue, not a lifetime
    ///      counter. `PuddleLpAdapter.redeem()` measures the value of the LP slice it
    ///      removed; the mock's equivalent is the value it handed out, which is why
    ///      this decrements and the deployed adapter's counter did not. Keeping the
    ///      two aligned is what lets the unit suite catch a divergence between the
    ///      mock and the real venue, which is exactly how the original bug shipped.
    function redeem(uint256 amount, address to) external onlyPool {
        uint256 available = IERC20(asset).balanceOf(address(this));
        if (amount > available) revert InsufficientLiquidity(amount, available);
        if (amount > principal) principal = 0; // clamp, never underflow
        else principal -= amount;
        IERC20(asset).safeTransfer(to, amount);
        emit Redeemed(amount, amount);
    }

    /// @dev TEST ONLY: inject asset as if real fees/interest had accrued.
    function injectYield(uint256 amount) external {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @inheritdoc IYieldAdapter
    function harvest() external onlyPool returns (uint256) {
        uint256 bal = IERC20(asset).balanceOf(address(this));
        if (bal <= principal) return 0;
        uint256 amount = bal - principal;
        // Realize it: move the surplus to the pool (the pool credits its own pot).
        IERC20(asset).safeTransfer(pool, amount);
        emit Harvested(amount);
        return amount;
    }

    /// @inheritdoc IYieldAdapter
    function principalDeployed() external view returns (uint256) {
        return principal;
    }

    /// @inheritdoc IYieldAdapter
    function positionValue() external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    /// @inheritdoc IYieldAdapter
    function liquidityUnits() external view returns (uint256) {
        return principal;
    }
}
