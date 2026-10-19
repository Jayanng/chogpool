// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/console2.sol";
import {DeployBase} from "./DeployBase.sol";
import {ITestChogToken} from "../interfaces/ITestChogToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Deploy.s.sol, deploys and wires the full Chog Pool stack on Monad testnet.
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
        _maybeSeedPot();
        vm.stopBroadcast();

        _writeDeployments();

        console2.log("--- deployed and wired ---");
        console2.log("operator            :", operator);
        console2.log("next step: run script/Gate1.s.sol for the end-to-end demo log");
    }

    /// @dev Seed the prize pot with real faucet USDC, if CHOGPOOL_SEED_POT is set.
    ///
    ///      WHY THIS IS A STEP IN THE DEPLOY. The pot's intended funding is
    ///      `harvest()`, which books the surplus the LP earns from PuddleSwap fees.
    ///      The Monad testnet USDC/USDT pair earns nothing: it is seeded ~20:1
    ///      imbalanced and has had no swaps, so `positionValue()` sits below
    ///      `principalDeployed()` and `harvest()` returns 0. Making that pot
    ///      visible through real trading would need on the order of 80x the pair's
    ///      entire USDC reserves in turnover, which is not achievable before the
    ///      deadline.
    ///
    ///      So the demo pot is seeded with real faucet USDC by a real transaction,
    ///      and it is recorded as a seed: `potSeeded` tracks it separately from
    ///      `potBalance`, so `potBalance - potSeeded` is always exactly the earned
    ///      yield. On this stack that figure is legitimately zero and the UI says
    ///      so, rather than blending the seed into a number labelled "yield".
    ///
    ///      Set CHOGPOOL_SEED_POT=0 to deploy without a seed and show a zero pot.
    function _maybeSeedPot() internal {
        uint256 seed = vm.envOr("CHOGPOOL_SEED_POT", uint256(0));
        if (seed == 0) {
            console2.log("pot seed            : none (CHOGPOOL_SEED_POT unset), pot starts at 0");
            return;
        }

        IERC20 asset = IERC20(reg.asset);
        uint256 have = asset.balanceOf(msg.sender);
        console2.log("pot seed requested  :", seed / 1e6, "USDC");
        console2.log("deployer USDC       :", have / 1e6, "USDC");
        if (have < seed) {
            console2.log("WARNING: deployer cannot fund the seed, skipping. Claim from the faucet first.");
            return;
        }

        // Runs INSIDE the caller's broadcast block: the deployer is already the
        // broadcast sender, so no nested startBroadcast. A nested one would abort
        // the whole script with "cannot prank for a broadcasted transaction".
        asset.approve(address(pool), seed);
        pool.seedPot(seed);

        console2.log("pot seeded          :", pool.potSeeded() / 1e6, "USDC (labelled SEEDED, not yield)");
        console2.log("pot balance         :", pool.potBalance() / 1e6, "USDC");
        console2.log("earned yield        :", (pool.potBalance() - pool.potSeeded()) / 1e6, "USDC (honest: zero on a quiet pair)");
    }
}
