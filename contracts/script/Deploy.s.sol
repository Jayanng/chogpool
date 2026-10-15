// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/console2.sol";
import {DeployBase} from "./DeployBase.sol";
import {ITestChogToken} from "../interfaces/ITestChogToken.sol";

/// @title Deploy.s.sol — deploys and wires the full Chog Pool stack on Monad testnet.
/// @notice See DeployBase.sol for the registry rules and the wiring verification.
///
/// Usage:
///   export PRIVATE_KEY=0x...
///   forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
contract Deploy is DeployBase {
    /// @dev The draw operator. Defaults to the deployer so a fresh deploy can run a
    ///      draw immediately; rotate to a dedicated key before real use.
    address operator = vm.envOr("DEPLOY_OPERATOR", address(0));

    function run() external {
        _loadRegistry();
        _requireTestnet();

        if (operator == address(0)) operator = msg.sender;

        vm.startBroadcast();
        _deployAll(msg.sender, operator);
        _wireAll();
        vm.stopBroadcast();

        _writeDeployments();

        console2.log("--- deployed and wired ---");
        console2.log("operator            :", operator);
        console2.log("next step: run script/Gate1.s.sol for the end-to-end demo log");
    }
}
