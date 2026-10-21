// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {GameEngine} from "../src/GameEngine.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {CareerStore} from "../src/CareerStore.sol";

/// @title DeployGameEngine, deploy the engine and wire BOTH consumers to it.
/// @notice The engine swap, complete, in one sitting:
///
///           1. deploy GameEngine
///           2. pool.setDrawEngine(gameEngine)         -> makes payPot accept it
///           3. careerStore.setDrawEngine(gameEngine)  -> makes recordRace accept it
///           4. setGameAuthority(recorder)             -> who may submit scores
///
///         WHY BOTH WIRINGS, NOT JUST THE POOL. `CareerStore.recordRace` is gated
///         to its own recorded engine (`onlyDrawEngine`). If step 3 is skipped,
///         every settlement reverts on the recordRace call and the leaderboard
///         silently never fills: the winners are paid, the round looks successful,
///         and the career page stays empty forever. A test suite that wires both
///         in setUp will never catch this, which is why it is called out here.
///
///         The pool, mirror, Test $CHOG and every deposit stay exactly where they
///         are. No deposit migration, no redeploy of the venue, and the stranding
///         fix and the seeded pot are untouched.
///
///         THE TREASURY IS FUNDED SEPARATELY, AND IT IS NOT OPTIONAL. The engine
///         pays coins at submission from its own Test $CHOG balance. An unfunded
///         engine reverts every `submitScores` with ERC20InsufficientBalance and
///         no run records at all. The faucet is claim-once-per-address-per-day, so
///         the funding has to be a deliberate step rather than something the
///         script can assume. Run it after this script, from the same key:
///
///           cast send <TEST_CHOG> "claim()" --rpc-url monad_testnet --private-key $PRIVATE_KEY
///           cast send <TEST_CHOG> "transfer(address,uint256)" <ENGINE> 1000000000000000000000 \
///             --rpc-url monad_testnet --private-key $PRIVATE_KEY
///
///         The script reads back the wirings AND the authority, so a run that
///         silently failed to wire cannot be mistaken for a success.
///
/// NO address is written as a literal. Every external address comes from
/// infra/verified.json or infra/deployments.json, read at runtime.
///
/// Usage (run by the POOL OWNER, from their own machine, key never in chat):
///   export PRIVATE_KEY=0x...        # the pool OWNER
///   export DEPLOY_OPERATOR=0x...    # the address that opens/closes/settles rounds
///   export GAME_AUTHORITY=0x...     # the recorder's public identity; defaults to operator
///   forge script script/DeployGameEngine.s.sol \
///     --rpc-url monad_testnet --broadcast --private-key $PRIVATE_KEY
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

        // Migration transaction 1 of 3: makes payPot accept the new engine, so
        // the prize can be paid at all.
        ChogPool(poolAddr).setDrawEngine(address(engine));
        console2.log("pool.setDrawEngine ->", address(engine));

        // Migration transaction 2 of 3: makes recordRace accept the new engine, so
        // the placings actually land on the leaderboard. Skipping this reverts
        // every settlement and silently leaves the career page empty.
        CareerStore(careersAddr).setDrawEngine(address(engine));
        console2.log("careerStore.setDrawEngine ->", address(engine));

        // Migration transaction 3 of 3: the recorder's public identity, set
        // explicitly rather than left as the constructor default. The recorder's
        // key can ONLY call submitScores, so this is the address the run records
        // arrive from. Owner-only, and re-pointable if the recorder rotates.
        if (authority != engine.gameAuthority()) {
            engine.setGameAuthority(authority);
            console2.log("engine.setGameAuthority ->", authority);
        }

        vm.stopBroadcast();

        // Read BOTH wirings back, plus the authority. A wiring that does not read
        // back is a silent failure: the app deploys, every address is valid, and
        // either the prize is unpayable, the leaderboard stays empty forever, or
        // the recorder cannot submit at all.
        require(ChogPool(poolAddr).drawEngine() == address(engine), "pool.drawEngine did not wire");
        require(CareerStore(careersAddr).drawEngine() == address(engine), "careerStore.drawEngine did not wire");
        require(engine.gameAuthority() == authority, "engine.gameAuthority did not set");

        console2.log("--- wired and verified ---");
        console2.log("NEXT, NOT OPTIONAL: fund the engine's Test $CHOG treasury or every");
        console2.log("  submitScores reverts with ERC20InsufficientBalance:");
        console2.log("    cast send <TEST_CHOG> \"claim()\" --rpc-url monad_testnet --private-key $PRIVATE_KEY");
        console2.log("    cast send <TEST_CHOG> \"transfer(address,uint256)\"", address(engine));
        console2.log("      1000000000000000000000 --rpc-url monad_testnet --private-key $PRIVATE_KEY");
        console2.log("  then: node infra/gen-addresses.mjs, add gameEngine to infra/deployments.json, push");
    }
}
