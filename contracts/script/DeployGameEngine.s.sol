// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {GameEngine} from "../src/GameEngine.sol";
import {ChogPool} from "../src/ChogPool.sol";

/// @title DeployGameEngine, one new contract, then point the pool at it.
/// @notice The product swaps from the commit-reveal draw to skill rounds by
///         replacing the engine and nothing else. `ChogPool.setDrawEngine` is
///         owner-gated and `payPot` only accepts calls from the current
///         drawEngine, so this is the entire migration:
///
///           1. deploy GameEngine (draw code inherited, round code added)
///           2. pool.setDrawEngine(gameEngine)
///
///         The pool, mirror, career store, Test $CHOG and every deposit stay
///         exactly where they are. No deposit migration, no redeploy of the venue,
///         and the stranding fix and the seeded pot are untouched.
///
/// NO address is written as a literal. Every external address comes from
/// infra/verified.json or infra/deployments.json, read at runtime.
///
/// Usage:
///   export PRIVATE_KEY=0x...        # the pool OWNER
///   forge script script/DeployGameEngine.s.sol \
///     --rpc-url monad_testnet --broadcast --private-key $PRIVATE_KEY
///
/// Set GAME_AUTHORITY to the address that will submit scores. It defaults to the
/// operator, which is the right starting point for a demo.
contract DeployGameEngine is Script {
    function run() external {
        string memory root = vm.projectRoot();
        string memory reg = vm.readFile(string.concat(root, "/../infra/verified.json"));
        string memory dep = vm.readFile(string.concat(root, "/../infra/deployments.json"));

        uint256 chainId = vm.parseJsonUint(reg, ".monadTestnet.chainId");
        address poolAddr = vm.parseJsonAddress(dep, ".pool");
        address careersAddr = vm.parseJsonAddress(dep, ".careerStore");
        address testChogAddr = vm.parseJsonAddress(dep, ".testChogToken");

        // Refuse to run against a chain the registry does not describe.
        if (block.chainid != chainId) {
            revert(
                string.concat(
                    "DeployGameEngine: refusing on chain ",
                    vm.toString(block.chainid),
                    "; registry describes ",
                    vm.toString(chainId)
                )
            );
        }

        address operator = vm.envOr("DEPLOY_OPERATOR", msg.sender);
        address authority = vm.envOr("GAME_AUTHORITY", operator);

        console2.log("chainId        :", chainId);
        console2.log("pool           :", poolAddr);
        console2.log("careerStore    :", careersAddr);
        console2.log("testChog       :", testChogAddr);
        console2.log("operator       :", operator);
        console2.log("gameAuthority  :", authority);

        vm.startBroadcast();

        GameEngine engine = new GameEngine(msg.sender, operator, careersAddr, testChogAddr, authority);
        console2.log("GameEngine     :", address(engine));

        // The one migration transaction. Everything else stays deployed.
        ChogPool(poolAddr).setDrawEngine(address(engine));
        console2.log("pool.setDrawEngine ->", address(engine));

        vm.stopBroadcast();

        // Read the wiring back. A wiring that does not read back is a silent
        // failure: the app deploys, every address is valid, and the pot is never
        // payable because payPot still rejects the new engine.
        require(ChogPool(poolAddr).drawEngine() == address(engine), "pool.drawEngine did not wire");

        console2.log("--- wired and verified ---");
        console2.log("next: add the engine to infra/deployments.json as gameEngine,");
        console2.log("      then regenerate the frontend addresses with gen-addresses.mjs");
    }
}
