// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title ITestChogToken, frozen contract between contracts/ and web/ (2026-10-14).
/// @notice FROZEN INTERFACE. Changing anything here requires BOTH owners to approve.
///
/// A real ERC-20 on testnet, explicitly labeled "Test CHOG" in name AND symbol
/// Used ONLY for the fun layers: cheering, draft rerolls, side
/// prizes. Never confused with the real mainnet $CHOG.
interface ITestChogToken is IERC20 {
    // ---------- events ----------

    event Claimed(address indexed account, uint256 amount, uint64 nextClaimAt);

    // ---------- errors ----------

    error CooldownActive(uint64 nextClaimAt);
    error ZeroAddress();

    // ---------- faucet ----------

    /// @notice Amount granted per successful claim (18 decimals).
    function claimAmount() external view returns (uint256);

    /// @notice Cooldown between claims, in seconds (86400 = one day).
    function claimCooldown() external view returns (uint64);

    /// @notice When `account` may next claim (0 when they can claim now).
    function nextClaimAt(address account) external view returns (uint64);

    /// @notice Claim the faucet amount. Reverts during the cooldown.
    function claim() external;

    // ---------- views ----------

    /// @notice Human-readable label for UI copy: "Test CHOG".
    function testLabel() external view returns (string memory);
}

/// @dev Convenience: the mirror ERC-721 surface the pool and UI rely on.
///      (IChogMirror.sol carries the full frozen interface; this alias keeps
///       contracts that only need ownership checks from importing the whole file.)
interface IChogMirrorOwnership is IERC721 {
    function badgeOf(uint256 tokenId) external view returns (uint8);
}
