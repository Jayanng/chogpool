// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {GameEngine} from "../src/GameEngine.sol";

/// @title SubmitRuns, the operator path from run records to submitScores.
/// @notice The game client writes a run record at the finish line (seed, input
///         tape, claimed numbers) and the Proof page re-derives it through the
///         same pure simulation. This script is the step after verification:
///         it takes verified records and submits their claimed numbers on
///         chain. The contract does not re-verify the tape and neither does
///         this script. The proof lives in the record and on the Proof page,
///         exactly as the site states.
///
///         COINS PAY HERE. `submitScores` pays each run `coins * 0.1` Test $CHOG
///         to the position's depositor in the same transaction. The engine must
///         hold the treasury or the whole call reverts.
///
/// INPUT: `run-records.json` next to this script (see run-records.example.json):
///   {
///     "roundId": 1,
///     "count": 1,
///     "runs": [
///       { "tokenId": 20,
///         "record": { "version": 1, "seed": "…", "lengthPx": 6000,
///                     "inputs": [ … ], "reviveAt": null,
///                     "claimed": { "score": 1234, "distance": 6000,
///                                  "coins": 12, "closeCalls": 3,
///                                  "cleared": true, "revived": false } } }
///     ]
///   }
///
///   `count` is explicit so the parsing never guesses how many entries exist.
///   The full record travels with each entry as evidence, even though only
///   tokenId, score, coins and revived go on chain.
///
/// NO address is written as a literal. Every external address comes from
/// infra/deployments.json, read at runtime.
///
/// Usage (run by the GAME AUTHORITY, from their own machine, key never in chat):
///   export PRIVATE_KEY=0x...        # the game authority key
///   forge script script/SubmitRuns.s.sol \
///     --rpc-url monad_testnet --broadcast --private-key $PRIVATE_KEY
contract SubmitRuns is Script {
    uint256 internal constant RECORD_VERSION = 1;

    function run() external {
        string memory root = vm.projectRoot();
        string memory dep = vm.readFile(string.concat(root, "/../infra/deployments.json"));
        string memory reg = vm.readFile(string.concat(root, "/../infra/verified.json"));

        uint256 chainId = vm.parseJsonUint(reg, ".monadTestnet.chainId");
        if (block.chainid != chainId) {
            revert(
                string.concat(
                    "SubmitRuns: refusing on chain ",
                    vm.toString(block.chainid),
                    "; registry describes ",
                    vm.toString(chainId)
                )
            );
        }

        address engineAddr = vm.parseJsonAddress(dep, ".gameEngine");
        GameEngine engine = GameEngine(engineAddr);

        string memory rec = vm.readFile(string.concat(root, "/run-records.json"));
        uint256 roundId = vm.parseJsonUint(rec, ".roundId");
        uint256 count = vm.parseJsonUint(rec, ".count");
        require(count > 0, "SubmitRuns: run-records.json has count 0");

        // The submitter must be the authority or every entry reverts. Say it
        // here rather than discovering it four transactions deep.
        require(msg.sender == engine.gameAuthority(), "SubmitRuns: sender is not the gameAuthority");

        // submitScores accepts rounds in Open or Closed state only. A settled
        // round must never be resubmitted.
        uint8 state = uint8(engine.roundState(roundId));
        require(state == 1 || state == 2, "SubmitRuns: round is not Open or Closed");

        uint256[] memory tokenIds = new uint256[](count);
        uint256[] memory scores = new uint256[](count);
        uint256[] memory coins = new uint256[](count);
        bool[] memory revived = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            string memory base = string.concat(".runs[", vm.toString(i), "]");
            uint256 version = vm.parseJsonUint(rec, string.concat(base, ".record.version"));
            require(version == RECORD_VERSION, "SubmitRuns: unsupported record version");
            require(
                !engine.hasRun(roundId, vm.parseJsonUint(rec, string.concat(base, ".tokenId"))),
                "SubmitRuns: that run is already recorded on chain"
            );

            tokenIds[i] = vm.parseJsonUint(rec, string.concat(base, ".tokenId"));
            scores[i] = vm.parseJsonUint(rec, string.concat(base, ".record.claimed.score"));
            coins[i] = vm.parseJsonUint(rec, string.concat(base, ".record.claimed.coins"));
            revived[i] = vm.parseJsonBool(rec, string.concat(base, ".record.claimed.revived"));

            console2.log("run", i);
            console2.log("  tokenId / score / coins:", tokenIds[i], scores[i], coins[i]);
            console2.log("  revived:", revived[i]);
        }

        vm.startBroadcast();
        engine.submitScores(roundId, tokenIds, scores, coins, revived);
        vm.stopBroadcast();

        // Read back that every run landed. A submission that silently dropped an
        // entry would pay its coins but never mark the run, and the round would
        // settle with a phantom participant missing.
        for (uint256 i = 0; i < count; i++) {
            require(engine.hasRun(roundId, tokenIds[i]), "SubmitRuns: run did not record on chain");
        }
        console2.log("--- all", count, "runs recorded on chain ---");
    }
}
