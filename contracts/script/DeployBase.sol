// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IChogMirror} from "../interfaces/IChogMirror.sol";
import {IChogPool} from "../interfaces/IChogPool.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";
import {IDrawEngine} from "../interfaces/IDrawEngine.sol";
import {ICareerStore} from "../interfaces/ICareerStore.sol";
import {ITestChogToken} from "../interfaces/ITestChogToken.sol";
import {ChogMirror} from "../src/ChogMirror.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {PuddleLpAdapter} from "../src/PuddleLpAdapter.sol";
import {DrawEngine} from "../src/DrawEngine.sol";
import {CareerStore} from "../src/CareerStore.sol";
import {TestChogToken} from "../src/TestChogToken.sol";

/// @title Deploy — full Chog Pool stack on Monad testnet.
/// @notice Single-command deployment in dependency order, then all wiring, then a
///         verification pass that re-reads every wiring and reverts if it is wrong.
///
/// NO address is written as a literal. Every external address comes from
/// infra/verified.json (read via vm.parseJson), so the registry stays the single
/// source of truth and this script cannot drift from it.
///
/// Writes the resulting addresses to infra/deployments.json so the frontend's
/// gen-addresses.mjs can generate the TS module from it.
///
/// Usage:
///   export PRIVATE_KEY=0x...        # deployer (also becomes initial owner)
///   forge script script/Deploy.s.sol \
///     --rpc-url monad_testnet --broadcast
///
/// The deployer must hold testnet MON (https://faucet.monad.xyz). No real value is
/// ever at stake: this is a testnet deployment of a zero-money game.
abstract contract DeployBase is Script {
    /// @dev Every external address, read from the registry at runtime.
    struct Registry {
        uint256 chainId;
        address asset; // PuddleSwap core USDC (testnet)
        address quoteToken; // PuddleSwap USDT — the LP's other leg
        address router; // UniswapV2Router02
        address pair; // USDC/USDT pair
        address faucetUSDC; // faucet-minted USDC (funding path)
        string chogMetadataBase; // ipfs://... metadata base
    }

    Registry internal reg;

    // ---------------- deployed handles ----------------
    ChogMirror mirror;
    ChogPool pool;
    PuddleLpAdapter adapter;
    DrawEngine engine;
    CareerStore careers;
    TestChogToken testChog;

    function _loadRegistry() internal {
        string memory json = vm.readFile("../infra/verified.json");

        // Every field is parsed individually, so a missing or renamed field fails
        // loudly here rather than silently yielding address(0).
        reg.chainId = vm.parseJsonUint(json, ".monadTestnet.chainId");
        reg.asset = vm.parseJsonAddress(json, ".monadTestnet.puddleUSDC.address");
        reg.quoteToken = vm.parseJsonAddress(json, ".monadTestnet.puddleUSDT.address");
        reg.router = vm.parseJsonAddress(json, ".monadTestnet.uniswapV2Router02.address");
        reg.pair = vm.parseJsonAddress(json, ".monadTestnet.pairs.USDC_USDT.address");
        reg.faucetUSDC = vm.parseJsonAddress(json, ".monadTestnet.faucetUSDC.address");
        reg.chogMetadataBase = vm.parseJsonString(json, ".monadTestnet.chogMetadataBase");

        console2.log("registry chainId      :", reg.chainId);
        console2.log("registry asset (USDC) :", reg.asset);
        console2.log("registry quote  (USDT):", reg.quoteToken);
        console2.log("registry router       :", reg.router);
        console2.log("registry pair         :", reg.pair);
        console2.log("registry faucetUSDC   :", reg.faucetUSDC);
    }

    /// @dev Refuse to deploy to a chain the registry does not describe. This catches
    ///      the "forgot --rpc-url" and "pointed at mainnet" mistakes, both of which
    ///      would otherwise deploy a testnet stack with mainnet asset addresses.
    function _requireTestnet() internal view {
        if (block.chainid != reg.chainId) {
            revert(
                string.concat(
                    "Deploy.s.sol: refusing to deploy on chain ",
                    vm.toString(block.chainid),
                    "; registry describes chain ",
                    vm.toString(reg.chainId)
                )
            );
        }
    }

    function _deployAll(address deployer, address operator) internal {
        mirror = new ChogMirror(reg.chogMetadataBase, deployer);
        console2.log("ChogMirror          :", address(mirror));

        pool = new ChogPool(reg.asset, address(mirror), deployer);
        console2.log("ChogPool            :", address(pool));

        // The adapter is deployed with the pool pre-wired: the pool is the only
        // caller allowed to supply/redeem/harvest. There is no owner on the adapter
        // by design — nobody, including the deployer, can pull deposited principal
        // back out; only the pool can redeem, and only to a depositor.
        adapter = new PuddleLpAdapter(reg.asset, reg.quoteToken, reg.router, reg.pair, address(pool));
        console2.log("PuddleLpAdapter     :", address(adapter));

        careers = new CareerStore(deployer);
        console2.log("CareerStore         :", address(careers));

        engine = new DrawEngine(deployer, operator);
        console2.log("DrawEngine          :", address(engine));

        // The default commit window is 6 hours, which is right for a live product:
        // it gives depositors a real window to enter before tickets freeze. It makes
        // a complete Gate 1 demo impossible in one sitting, because closeDraw()
        // requires block.timestamp >= closeAt and a real chain cannot be warped.
        //
        // A deploy meant to be demoed end-to-end therefore overrides the window via
        // CHOGPOOL_COMMIT_WINDOW. The override is only applied when the env var is
        // set, and it is recorded in the deploy log so the deployed timing is never
        // a surprise. The contract logic is identical — only the timing constant
        // differs — so a demo-window stack proves exactly what a 6h stack proves,
        // just without the wait.
        if (vm.envOr("CHOGPOOL_COMMIT_WINDOW", uint256(0)) != 0) {
            uint64 w = uint64(vm.envUint("CHOGPOOL_COMMIT_WINDOW"));
            engine.setCommitWindow(w);
            console2.log("commitWindow override:", w, "seconds");
        }

        testChog = new TestChogToken(deployer, 1000e18, 24 hours);
        console2.log("TestChogToken       :", address(testChog));
    }

    /// @dev Wire everything and re-read it back. A wiring that does not read back is
    ///      a silent failure mode: the stack deploys, every address is valid, and the
    ///      draw never runs. Reverting here is the difference between a failed deploy
    ///      and a broken live app.
    /// @dev No vm.prank/startPrank here. This runs inside vm.startBroadcast(), where
    ///      the cheatcodes cannot change msg.sender — the broadcast sender IS the
    ///      deployer, and the deployer is the owner of every contract, so the calls
    ///      are already authorized. (Pranking inside a broadcast aborts the whole
    ///      script with "cannot prank for a broadcasted transaction".)
    function _wireAll() internal {
        pool.setYieldAdapter(address(adapter));
        require(pool.yieldAdapter() == address(adapter), "pool.yieldAdapter did not wire");

        pool.setDrawEngine(address(engine));
        require(pool.drawEngine() == address(engine), "pool.drawEngine did not wire");

        engine.setPool(address(pool));
        require(engine.pool() == address(pool), "engine.pool did not wire");

        engine.setCareerStore(address(careers));
        require(engine.careerStore() == address(careers), "engine.careerStore did not wire");

        careers.setDrawEngine(address(engine));
        require(careers.drawEngine() == address(engine), "careers.drawEngine did not wire");

        // The adapter's asset and pair must be the registry ones — a mismatch here
        // would silently route yield into the wrong venue.
        require(address(adapter.asset()) == reg.asset, "adapter.asset is not the registry asset");
        require(address(adapter.pair()) == reg.pair, "adapter.pair is not the registry pair");
        require(address(adapter.router()) == reg.router, "adapter.router is not the registry router");
        require(adapter.pool() == address(pool), "adapter.pool did not wire");
        require(pool.asset() == reg.asset, "pool.asset is not the registry asset");
    }

    /// @dev Writes the deployment record. The path is INSIDE contracts/ on purpose:
    ///      forge's fs_permissions only grants writes within the project root that
    ///      foundry.toml lives in, and a `../infra/...` write is refused even when
    ///      the permission is declared. Reads from ../infra work fine (the fork
    ///      tests and the Gate 1 script rely on that), so the asymmetry is
    ///      write-specific. The file is moved to infra/ by the deploy step in the
    ///      shell, which is where the registry generator expects it.
    function _writeDeployments() internal {
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "mirror", address(mirror));
        vm.serializeAddress(obj, "pool", address(pool));
        vm.serializeAddress(obj, "yieldAdapter", address(adapter));
        vm.serializeAddress(obj, "drawEngine", address(engine));
        vm.serializeAddress(obj, "careerStore", address(careers));
        vm.serializeAddress(obj, "testChogToken", address(testChog));
        vm.serializeAddress(obj, "asset", reg.asset);
        vm.serializeAddress(obj, "quoteToken", reg.quoteToken);
        vm.serializeAddress(obj, "router", reg.router);
        vm.serializeAddress(obj, "pair", reg.pair);
        vm.serializeUint(obj, "deployedAt", block.timestamp);
        string memory json = vm.serializeAddress(obj, "deployer", msg.sender);
        vm.writeJson(json, "deployments.json");
        console2.log("wrote contracts/deployments.json (move to infra/ after deploy)");
    }
}
