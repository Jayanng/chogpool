// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IPuddleRouter, the subset of PuddleSwap's UniswapV2Router02 the adapter uses.
/// @notice Minimal surface for the real router at the registry-resolved testnet address.
///         Declared locally (not in the frozen interfaces folder) because it describes a
///         third-party contract, not the boundary between our two teams.
/// @dev Signatures are the STANDARD UniswapV2 ones, verified live against the router at
///      0x430c...6660 on Monad testnet (`cast call getAmountsOut(uint256,address[])`
///      returns a quote). Do NOT "simplify" them into a (tokenIn, tokenOut) form, a
///      non-standard signature compiles cleanly and then reverts on every real call,
///      which is exactly the trap this comment exists to prevent.
interface IPuddleRouter {
    function factory() external view returns (address);

    /// @notice Quote a path without executing. `amounts[amounts.length - 1]` is the
    ///         output for `amountIn`.
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);
}
