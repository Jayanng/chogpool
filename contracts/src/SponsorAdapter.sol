// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";

/// @title SponsorAdapter, the no-loss venue: principal is held, never deployed.
/// @notice Implementation of the FROZEN IYieldAdapter interface where the pot is funded
///         from OUTSIDE the depositors' principal. A sponsor transfers asset to this
///         adapter, and harvest() books exactly the tokens that physically arrived.
///
/// @dev Why this satisfies "no loss" where PuddleLpAdapter cannot:
///      - Principal never leaves this contract as anything other than plain asset.
///        There is no conversion step, so no entry cost and no impermanent loss.
///        A deposit of N credits N shares and redeems for N, always.
///      - redeem() returns the full principal instantly by construction: the asset
///        sits here, in no venue that could be thin, mispriced, or drained by an
///        earlier withdrawal of a shared position.
///
/// @dev HARD RULE compliance: the pot only ever grows from tokens that actually
///      moved. A sponsor transfer is a real ERC-20 transaction, not paper accounting,
///      and harvest() measures `balance - principalDeployed`, so it can never book
///      more than physically arrived and can never touch principal.
///
/// @dev The trade-off, stated plainly: there is no yield on principal. The prize is
///      funded by a sponsor (testnet) or by protocol revenue (production), not by
///      borrowers. That is the honest cost of a hard no-loss guarantee. If a venue
///      with genuine yield is wanted later, the AaveAdapter named in IYieldAdapter is
///      the production path.
contract SponsorAdapter is IYieldAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------- immutables ----------------

    /// @inheritdoc IYieldAdapter
    address public immutable asset;

    /// @inheritdoc IYieldAdapter
    address public immutable pool;

    // ---------------- state ----------------

    /// @inheritdoc IYieldAdapter
    /// @dev Invariant: this equals the pool's totalShares at all times, because every
    ///      share is credited 1:1 with the asset that was supplied. Nothing else moves
    ///      this counter except supply() and redeem().
    uint256 public principalDeployed;

    error ZeroAddress();

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool();
        _;
    }

    constructor(address asset_, address pool_) {
        if (asset_ == address(0) || pool_ == address(0)) revert ZeroAddress();
        asset = asset_;
        pool = pool_;
    }

    // ---------------- pool-only operations ----------------

    /// @inheritdoc IYieldAdapter
    /// @dev Nothing is swapped and nothing is deployed, so the value the pool measures
    ///      across this call grows by exactly `amount`: the pool credits 1:1 shares,
    ///      and a deposit of N always arrives worth N. No entry cost exists to hide.
    function supply(uint256 amount) external nonReentrant onlyPool {
        if (amount == 0) revert AdapterZeroAmount();

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        principalDeployed += amount;

        emit Supplied(amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Must always be able to return the FULL principal, instantly. It can: the
    ///      principal is plain asset sitting in this contract. The sponsor's surplus is
    ///      never spent on a redemption, so withdrawals can never eat the pot funding.
    function redeem(uint256 amount, address to) external nonReentrant onlyPool {
        if (amount == 0) revert AdapterZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (amount > principalDeployed) revert InsufficientLiquidity(amount, principalDeployed);

        uint256 held = IERC20(asset).balanceOf(address(this));
        if (held < amount) revert InsufficientLiquidity(amount, held);

        principalDeployed -= amount;
        IERC20(asset).safeTransfer(to, amount);

        emit Redeemed(amount, amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Books the sponsored surplus: everything held above principal. The transfer
    ///      out MUST happen here, because the pool credits potBalance with the returned
    ///      number; if the tokens stayed in this adapter the pool would book a pot it
    ///      does not hold and every winner payout would revert.
    /// @dev Returns 0 when no sponsor has funded anything yet. The pool then reverts
    ///      NothingToHarvest, which is the honest answer: there is nothing to pay out.
    function harvest() external nonReentrant onlyPool returns (uint256 amount) {
        uint256 surplus = realizableSurplus();
        if (surplus == 0) return 0;

        IERC20(asset).safeTransfer(pool, surplus);
        amount = surplus;

        emit Harvested(amount);
    }

    // ---------------- views ----------------

    /// @inheritdoc IYieldAdapter
    /// @dev The asset value this adapter can hand back right now: principal plus any
    ///      sponsor funding that has arrived and not yet been harvested.
    function positionValue() external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    /// @inheritdoc IYieldAdapter
    /// @dev No venue, no units. Returns 0 rather than a fake number, because there is
    ///      no LP token to report and the pot never depends on one.
    function liquidityUnits() external view returns (uint256) {
        return 0;
    }

    /// @notice The surplus harvest() would realize right now, or 0 if there is none.
    /// @dev Same purpose as PuddleLpAdapter.realizableSurplus(): a caller that must not
    ///      broadcast a reverting transaction decides from chain state first, instead of
    ///      discovering NothingToHarvest at gas-estimation time.
    function realizableSurplus() public view returns (uint256) {
        uint256 held = IERC20(asset).balanceOf(address(this));
        return held > principalDeployed ? held - principalDeployed : 0;
    }
}
