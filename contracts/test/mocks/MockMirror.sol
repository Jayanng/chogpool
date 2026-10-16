// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockMirror: DEV/TEST ONLY. Never imported by contracts/src.
/// @notice Minimal ERC-721 ownership surface so pool tests can bind tokenIds without
///         deploying the real mirror. Only ownerOf/setOwnerOf are used by the pool.
contract MockMirror {
    mapping(uint256 => address) private _owners;

    function setOwnerOf(uint256 tokenId, address owner) external {
        _owners[tokenId] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return _owners[tokenId];
    }

    function badgeOf(uint256 tokenId) external pure returns (uint8) {
        tokenId; // unused
        return 0;
    }
}
