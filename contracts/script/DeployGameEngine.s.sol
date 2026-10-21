// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {GameEngine} from "../src/GameEngine.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {CareerStore} from "../src/CareerStore.sol";

/// @title DeployGameEngine, one new contract, then point BOTH consumers at it.
/// @notice The product swaps from the commit-reveal draw to skill rounds by
///         replacing the engine and nothing else. `ChogPool.setDrawEngine` is
///         owner-gated and `payPot` only accepts calls from the current
///         drawEngine, so the pool swap is required for the prize to be payable
///         at all. But it is not sufficient on its own, and the missing half is
///         the dangerous one:
///
///           1. deploy GameEngine (draw code inherited, round code added)
///           2. pool.setDrawEngine(gameEngine)      -> makes payPot accept the engine
///           3. careerStore.setDrawEngine(gameEngine) -> makes recordRace accept it
///
///         WHY BOTH, NOT JUST THE POOL. `CareerStore.recordRace` is gated to its
///         own recorded engine (`onlyDrawEngine`). If step 3 is skipped, every
///         settlement reverts on the recordRace call and the leaderboard silently
///         never fills: the winners are paid, the round looks successful, and the
///         career page stays empty forever. A test suite that wires both in setUp
///         will never catch this, which is exactly why it is called out here.
///
///         The pool, mirror, Test $CHOG and every deposit stay exactly where they
///         are. No deposit migration, no redeploy of the venue, and the stranding
///         fix and the seeded pot are untouched.
///
/// NO address is written as a literal. Every external address comes from
/// infra/verified.json or infra/deployments.json, read at runtime.
///
/// Usage (run by the POOL OWNER, from their own machine, key never in chat):
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

        // Migration transaction 1 of 2: makes payPot accept the new engine, so
        // the prize can be paid at all.
        ChogPool(poolAddr).setDrawEngine(address(engine));
        console2.log("pool.setDrawEngine ->", address(engine));

        // Migration transaction 2 of 2: makes recordRace accept the new engine, so
        // the placings actually land on the leaderboard. Skipping this reverts
        // every settlement and silently leaves the career page empty.
        CareerStore(careersAddr).setDrawEngine(address(engine));
        console2.log("careerStore.setDrawEngine ->", address(engine));

        vm.stopBroadcast();

        // Read BOTH wirings back. A wiring that does not read back is a silent
        // failure: the app deploys, every address is valid, and either the prize
        // is unpayable or the leaderboard stays empty forever.
        require(ChogPool(poolAddr).drawEngine() == address(engine), "pool.drawEngine did not wire");
        require(CareerStore(careersAddr).drawEngine() == address(engine), "careerStore.drawEngine did not wire");

        console2.log("--- wired and verified ---");
        console2.log("next: add the engine to infra/deployments.json as gameEngine,");
        console2.log("      then regenerate the frontend addresses with gen-addresses.mjs");
    }
}
