// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Toolchain smoke contract, not part of the product.
contract Hello {
    string public constant GREETING = "Chog Track";

    function ping() external pure returns (string memory) {
        return GREETING;
    }
}
