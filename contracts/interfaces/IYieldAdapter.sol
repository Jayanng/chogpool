// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IYieldAdapter, frozen contract between contracts/ and web/ (2026-10-14).
/// @notice FROZEN INTERFACE. Changing anything here requires BOTH owners to approve.
///
/// Two implementations are specified, one per venue:
///  - PuddleLpAdapter: testnet demo. USDC -> addLiquidity to the real USDC/USDT pair.
///    Harvest redeems a small LP slice, measures the real value surplus versus the
///    pro-rata deposit, swaps the surplus to the asset, and returns it to the pool.
///  - AaveAdapter: production. supply/withdraw on the verified Aave V3.7 Pool.
///    Mainnet-ready, testnet-forbidden (Aave is not on Monad testnet).
///
/// HARD RULE: the pot only ever grows from value realized through
/// actual removeLiquidity/swap/supply-withdraw transactions. No paper fee accounting.
interface IYieldAdapter {
    // ---------- events ----------

    event Supplied(uint256 amount);
    event Redeemed(uint256 lpAmount, uint256 amountOut);
    event Harvested(uint256 amount);

    // ---------- errors ----------

    error NotPool();
    /// @dev Named distinctly from IChogPool.ZeroAmount so a contract can inherit both.
    error AdapterZeroAmount();
    error NothingToHarvest();
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error SlippageExceeded(uint256 expected, uint256 minOut);

    // ---------- views ----------

    /// @notice The pool this adapter serves.
    function pool() external view returns (address);

    /// @notice The stable asset this adapter denominates in.
    function asset() external view returns (address);

    /// @notice Principal (asset units) currently deployed into the yield venue.
    function principalDeployed() external view returns (uint256);

    /// @notice Current redeemable value of the deployed position (asset units).
    /// @dev Read live from the venue (LP redemption or aToken balance). The difference
    ///      versus principalDeployed is realized yield, but only `harvest()` makes it real.
    function positionValue() external view returns (uint256);

    /// @notice LP tokens (or venue units) held by this adapter.
    function liquidityUnits() external view returns (uint256);

    // ---------- pool-only operations ----------

    /// @notice Deploy `amount` of the asset into the yield venue. Called by the pool.
    function supply(uint256 amount) external;

    /// @notice Pull `amount` of the asset back out of the venue to `to`. Called by the pool.
    /// @dev Must always be able to return the FULL principal, instantly.
    function redeem(uint256 amount, address to) external;

    /// @notice Realize accrued yield and transfer it to the pool as asset.
    /// @return amount the asset units moved into the pot
    function harvest() external returns (uint256 amount);
}
