// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {PuddleLpAdapter} from "../src/PuddleLpAdapter.sol";
import {DrawEngine} from "../src/DrawEngine.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";

/// @title MigrateStack, move the pool off the broken adapter with the smallest
///        possible blast radius.
/// @notice Deploys a NEW pool and a NEW adapter, binds the new pool to the EXISTING
///         mirror, re-points the EXISTING draw engine at it, and re-deposits the one
///         live position into the fresh venue. The mirror, CareerStore trophies and
///         the entire draw history survive untouched.
///
/// @dev WHY A NEW POOL IS UNAVOIDABLE. `ChogPool.setYieldAdapter()` on the live
///      contract still reads the OLD adapter's `principalDeployed()` to decide
///      whether a re-point is safe, and that counter is permanently inflated at
///      65.472034 because it only ever increased and Solidity state cannot be
///      patched. Verified against the live chain: the re-point reverts
///      `InsufficientLiquidity(65472034, 0)` forever. The improved guard (which
///      reads the pool's own `totalPrincipal` instead) only exists in source, so it
///      cannot reach the deployed pool. A new pool is the only way to get that guard
///      live.
///
/// @dev WHAT SURVIVES, AND WHAT DOES NOT. The mirror is a separate contract and is
///      bound by address, so the existing one is reused as-is: every Chog token,
///      every Test Drive mint and every signature stays valid. CareerStore and
///      DrawEngine are likewise separate and reused, so draw 1's on-chain record,
///      the frozen ticket book, the winner and the trophy count are all preserved.
///      Only the pool is replaced, and only one live position has to be re-deposited.
///
/// @dev THE HONEST COST, measured not estimated. The old adapter's position is worth
///      788,226 while the position's shares are 887,422, so the venue can pay
///      788,226 and the remaining 99,196 is a claim it cannot honour. Verified in
///      `test/StrandedSharesFork.t.sol` by draining the venue inside one transaction
///      frame and then attempting the residue: it reverts. The residue is therefore
///      STRANDED, not recoverable, and this script drains what the venue can pay and
///      records the 99,196 shortfall explicitly rather than pretending it is zero.
///
/// @dev NO ADDRESS LITERALS. Everything comes from infra/deployments.json (the
///      current stack) and infra/verified.json (the registry), read at runtime.
///
/// @dev USAGE, always in this order:
///         forge script script/MigrateStack.s.sol --rpc-url monad_testnet            # dry run
///         export PRIVATE_KEY=0x...
///         forge script script/MigrateStack.s.sol --rpc-url monad_testnet --broadcast
contract MigrateStack is Script {
    using SafeERC20 for IERC20;

    // ---------------- configuration ----------------

    uint256 tokenId;
    address asset;
    address quoteToken;
    address router;
    address pair;

    // ---------------- the stack ----------------

    ChogPool oldPool;
    PuddleLpAdapter oldAdapter;
    ChogMirrorHandle mirror;
    DrawEngine engine;

    ChogPool newPool;
    PuddleLpAdapter newAdapter;

    function setUp() public {
        string memory root = vm.projectRoot();
        string memory dep = vm.readFile(string.concat(root, "/../infra/deployments.json"));
        string memory reg = vm.readFile(string.concat(root, "/../infra/verified.json"));

        tokenId = vm.envOr("MIGRATE_TOKEN_ID", uint256(954));
        asset = vm.parseJsonAddress(reg, ".monadTestnet.puddleUSDC.address");
        quoteToken = vm.parseJsonAddress(reg, ".monadTestnet.puddleUSDT.address");
        router = vm.parseJsonAddress(reg, ".monadTestnet.uniswapV2Router02.address");
        pair = vm.parseJsonAddress(reg, ".monadTestnet.pairs.USDC_USDT.address");

        oldPool = ChogPool(vm.parseJsonAddress(dep, ".pool"));
        oldAdapter = PuddleLpAdapter(vm.parseJsonAddress(dep, ".yieldAdapter"));
        mirror = ChogMirrorHandle(vm.parseJsonAddress(dep, ".mirror"));
        engine = DrawEngine(vm.parseJsonAddress(dep, ".drawEngine"));

        console2.log("=== migrate stack: configuration ===");
        console2.log("old pool            :", address(oldPool));
        console2.log("old adapter         :", address(oldAdapter));
        console2.log("mirror (reused)     :", address(mirror));
        console2.log("engine (reused)     :", address(engine));
        console2.log("token carried       :", tokenId);
    }

    function run() public {
        _requireTestnet();

        // ---------- before ----------
        (address depositor, uint256 sharesBefore, uint256 principalBefore) = oldPool.depositOf(tokenId);
        uint256 oldBasis = oldAdapter.principalDeployed();
        uint256 oldValue = oldAdapter.positionValue();
        uint256 oldPot = oldPool.potBalance();

        console2.log("=== before ===");
        console2.log("depositor           :", depositor);
        console2.log("shares              :", sharesBefore);
        console2.log("recorded principal  :", principalBefore);
        console2.log("old adapter basis   :", oldBasis);
        console2.log("old adapter value   :", oldValue);
        console2.log("old pool pot        :", oldPot);

        if (sharesBefore == 0) revert("MigrateStack: token holds no shares, nothing to carry");
        if (oldValue == 0) revert("MigrateStack: old adapter already drained");

        // The shortfall is measured, not estimated, and printed rather than hidden.
        uint256 shortfall = sharesBefore > oldValue ? sharesBefore - oldValue : 0;
        console2.log("shortfall (stranded):", shortfall);

        // The depositor must hold the mirror token for the new pool to accept a
        // deposit against it. The mirror is reused, so this should already hold.
        if (mirror.ownerOf(tokenId) != depositor) {
            revert("MigrateStack: depositor does not hold the mirror token, cannot re-deposit");
        }

        // ---------- 1. drain the old pool down to what the venue can pay ----------
        // `withdraw` is owner-callable, so the broadcaster (the pool owner) can
        // recover the position's real value on the depositor's behalf. The asset
        // goes to the DEPOSITOR, which is where the re-deposit in step 5 draws from.
        vm.startBroadcast();
        if (msg.sender != oldPool.owner()) revert("MigrateStack: sender is not the pool owner");
        oldPool.withdraw(tokenId, oldValue);
        vm.stopBroadcast();

        (, uint256 sharesAfterDrain, uint256 principalAfterDrain) = oldPool.depositOf(tokenId);
        console2.log("=== old pool drained ===");
        console2.log("shares remaining    :", sharesAfterDrain);
        console2.log("principal remaining :", principalAfterDrain);
        console2.log("venue value now     :", oldAdapter.positionValue());

        // ---------- 2. deploy the new adapter and the new pool ----------
        // The new pool binds to the EXISTING mirror, so every token and every mint
        // stays valid and no depositor has to re-mint.
        //
        // Deployment order, and why it is this way: the adapter's `pool` is an
        // immutable set at construction (nobody, including the deployer, can
        // redirect where principal goes), so the pool MUST exist before the adapter
        // is deployed. The pool's adapter is a settable slot, so the pool can be
        // deployed first and wired second. Pool first, adapter second, then wire.
        vm.startBroadcast();
        newPool = new ChogPool(asset, address(mirror), msg.sender);
        vm.stopBroadcast();

        vm.startBroadcast();
        newAdapter = new PuddleLpAdapter(asset, quoteToken, router, pair, address(newPool));
        vm.stopBroadcast();

        console2.log("=== new stack ===");
        console2.log("new pool            :", address(newPool));
        console2.log("new adapter         :", address(newAdapter));

        // ---------- 3. wire the new pool ----------
        vm.startBroadcast();
        if (msg.sender != newPool.owner()) revert("MigrateStack: sender is not the new pool owner");
        // The new pool starts empty, so the improved guard (which reads the pool's
        // own totalPrincipal) passes immediately.
        newPool.setYieldAdapter(address(newAdapter));
        vm.stopBroadcast();

        if (newPool.yieldAdapter() != address(newAdapter)) revert("MigrateStack: new pool did not wire");

        // ---------- 4. re-point the existing engine at the new pool ----------
        // The engine reads TWAB and pays the pot THROUGH the pool, so it must point
        // at the pool that holds the positions. Verified callable from the owner.
        vm.startBroadcast();
        if (msg.sender != engine.owner()) revert("MigrateStack: sender is not the engine owner");
        engine.setPool(address(newPool));
        vm.stopBroadcast();

        if (engine.pool() != address(newPool)) revert("MigrateStack: engine did not re-point");

        // ---------- 5. re-deposit the recovered position ----------
        // The depositor holds the drained asset, so this rebuilds the position in
        // the new venue with a basis measured from scratch.
        uint256 redeposit = IERC20(asset).balanceOf(depositor);
        console2.log("=== re-deposit ===");
        console2.log("depositor balance   :", redeposit);
        if (redeposit == 0) revert("MigrateStack: depositor holds no asset to re-deposit");

        vm.startBroadcast(depositor);
        IERC20(asset).forceApprove(address(newPool), redeposit);
        vm.stopBroadcast();

        vm.startBroadcast(depositor);
        newPool.deposit(tokenId, redeposit);
        vm.stopBroadcast();

        // ---------- 6. verify ----------
        (, uint256 sharesAfter, uint256 principalAfter) = newPool.depositOf(tokenId);
        uint256 newBasis = newAdapter.principalDeployed();
        uint256 newValue = newAdapter.positionValue();
        uint256 newShares = newPool.totalShares();

        console2.log("=== after ===");
        console2.log("new shares          :", sharesAfter);
        console2.log("new principal       :", principalAfter);
        console2.log("new basis           :", newBasis);
        console2.log("new value           :", newValue);
        console2.log("new totalShares     :", newShares);

        // The property this migration exists to restore: the basis describes the
        // position, so harvest can see yield again.
        if (newBasis > newValue + (newValue / 10)) {
            revert("MigrateStack: new basis is inflated above the position");
        }
        if (newAdapter.liquidityUnits() == 0) revert("MigrateStack: new adapter holds no LP");
        if (newPool.totalPrincipal() != newPool.totalShares()) revert("MigrateStack: new pool books disagree");
        if (engine.pool() != address(newPool)) revert("MigrateStack: engine not wired to the new pool");

        // ---------- 7. write the deployment record ----------
        _writeDeployments();

        console2.log("=== migration complete ===");
        console2.log("stranded shortfall  :", shortfall);
        console2.log("next step: node infra/gen-addresses.mjs, then redeploy the web app");
    }

    // ---------------- guards ----------------

    function _requireTestnet() internal view {
        string memory root = vm.projectRoot();
        string memory reg = vm.readFile(string.concat(root, "/../infra/verified.json"));
        if (block.chainid != vm.parseJsonUint(reg, ".monadTestnet.chainId")) {
            revert("MigrateStack: refusing to run on a chain the registry does not describe");
        }
        if (block.chainid == 143) revert("MigrateStack: refusing to run on Monad mainnet");
    }

    function _writeDeployments() internal {
        string memory root = vm.projectRoot();
        string memory dep = vm.readFile(string.concat(root, "/../infra/deployments.json"));

        string memory obj = "deployment";
        vm.serializeAddress(obj, "pool", address(newPool));
        vm.serializeAddress(obj, "yieldAdapter", address(newAdapter));
        // Everything else is deliberately carried over unchanged: this migration
        // replaces the pool and the venue and nothing else.
        vm.serializeAddress(obj, "mirror", vm.parseJsonAddress(dep, ".mirror"));
        vm.serializeAddress(obj, "drawEngine", vm.parseJsonAddress(dep, ".drawEngine"));
        vm.serializeAddress(obj, "careerStore", vm.parseJsonAddress(dep, ".careerStore"));
        vm.serializeAddress(obj, "testChogToken", vm.parseJsonAddress(dep, ".testChogToken"));
        vm.serializeAddress(obj, "asset", vm.parseJsonAddress(dep, ".asset"));
        vm.serializeAddress(obj, "quoteToken", vm.parseJsonAddress(dep, ".quoteToken"));
        vm.serializeAddress(obj, "router", vm.parseJsonAddress(dep, ".router"));
        vm.serializeAddress(obj, "pair", vm.parseJsonAddress(dep, ".pair"));
        vm.serializeAddress(obj, "deployer", vm.parseJsonAddress(dep, ".deployer"));
        vm.serializeUint(obj, "chainId", vm.parseJsonUint(dep, ".chainId"));
        vm.serializeUint(obj, "deployedAt", block.timestamp);
        string memory json = vm.serializeAddress(obj, "migratedFromPool", address(oldPool));
        vm.writeJson(json, "deployments.json");
        console2.log("wrote contracts/deployments.json (move to infra/ after deploy)");
    }
}

/// @dev Minimal handle for the mirror's ownerOf, so the script can confirm the
///      depositor still holds the token it is about to re-deposit against.
interface ChogMirrorHandle {
    function ownerOf(uint256 tokenId) external view returns (address);
}
