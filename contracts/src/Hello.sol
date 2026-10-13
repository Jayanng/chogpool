// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Phase 0 toolchain smoke contract. Removed in Phase 1.
contract Hello {
    string public constant GREETING = "Chog Track";

    function ping() external pure returns (string memory) {
        return GREETING;
    }
}
