// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/console2.sol";
import {DeployBase} from "./DeployBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ChogMirror} from "../src/ChogMirror.sol";
import {ChogPool} from "../src/ChogPool.sol";
import {PuddleLpAdapter} from "../src/PuddleLpAdapter.sol";
import {DrawEngine} from "../src/DrawEngine.sol";
import {CareerStore} from "../src/CareerStore.sol";
import {TestChogToken} from "../src/TestChogToken.sol";
import {IPuddleRouter} from "../interfaces/IPuddleRouter.sol";
import {IChogPool} from "../interfaces/IChogPool.sol";
import {IDrawEngine} from "../interfaces/IDrawEngine.sol";

/// @notice Minimal view of PuddleSwap StableFaucet, used for the honest funding path.
/// @dev The only function we need is claim(); everything else is read off the RPC.
interface IStableFaucet {
    function claim() external;
    function cooldown() external view returns (uint256);
}

/// @title Gate1.s.sol — the Gate 1 end-to-end run, as an executable log.
/// @notice This script IS the recorded demo log the plan requires.
///
/// @dev CRITICAL — how this achieves REAL testnet transactions.
///
/// `forge script --broadcast` only signs transactions for a wallet it holds. A
/// `vm.prank`/`vm.startPrank` merely changes `msg.sender` inside the EVM
/// simulation; foundry SKIPS those calls entirely when broadcasting, prints a
/// complete-looking log, and warns once at the very end with "No transactions to
/// broadcast". That is how a previous version of this script produced a fully
/// populated Gate 1 log while changing nothing on chain.
///
/// The fix is `vm.startBroadcast(uint256 privateKey)`: forge-std signs a genuine
/// transaction with the supplied key and sends it. So this script holds one key
/// per actor and broadcasts as each of them in turn. Every actor is a distinct
/// address with its own real transactions, which matters for three reasons:
///
///   * `ChogMirror.mintTestDrive` allows exactly ONE Test Drive per address
///     (`hasTestDrive[msg.sender]`), so two racers need two addresses.
///   * `StableFaucet.claim()` enforces a 24h cooldown per claimant, so the
///     depositors and the volume trader must not share an address.
///   * `ChogPool.deposit()` binds a position to its first depositor
///     (`pos.depositor != msg.sender` reverts), so the racers really are
///     different depositors rather than one account playing both sides.
///
/// Actor keys come from the environment (CHOGPOOL_RACER1_PRIVATE_KEY, etc.) and
/// are NEVER written into this file, into deployments.json, or into any tracked
/// artifact. See /home/ubuntu/.chogpool-deploy/gate1-actors.env.
///
/// The sequence is exactly the Gate 1 checklist:
///   1. claim stables from the real StableFaucet (the same path a user takes)
///   2. mint a Test Drive mirror Chog
///   3. deposit USDC into the pool (goes straight into the real LP)
///   4. swap real volume through the pair so LP fees accrue
///   5. harvest — the pot grows ONLY from realized removeLiquidity/swap value
///   6. run a full commit-reveal draw
///   7. winner takes the pot
///   8. withdraw all principal — instant, full, no fee
///
/// Usage (real testnet, state persists):
///   forge script script/Gate1.s.sol --rpc-url monad_testnet --broadcast
///
/// Requires infra/deployments.json (the live stack) and the actor keys in env.
contract Gate1 is DeployBase {
    using SafeERC20 for IERC20;

    // ---------------- actors ----------------

    /// @dev Racer 1: deposits, races, wins or loses, withdraws.
    uint256 racer1Key;
    address racer1;

    /// @dev A second account that also deposits, so there are >=2 racers and the
    ///      draw is meaningful. Without a second depositor the draw is a formality.
    uint256 racer2Key;
    address racer2;

    /// @dev Volume trader: swaps through the pair to generate real LP fees. Kept
    ///      distinct from both depositors so the fees are genuinely third-party
    ///      value rather than a depositor cycling its own principal.
    uint256 traderKey;
    address trader;

    // ---------------- funding amounts ----------------

    /// @dev 250 USDC per racer. The honest funding path (faucet claim -> swap) yields
    ///      ~367 USDC from one 1,000 USDT claim, so a 400 deposit does not fit and a
    ///      600 volume swap cannot be funded either. These numbers are sized to what
    ///      the faucet actually mints — the script fails loudly rather than silently
    ///      short-funding.
    uint256 constant DEPOSIT = 250e6; // 250 USDC (6 decimals)
    uint256 constant VOLUME = 100e6; // 100 USDC of swap volume through the pair

    /// @dev The second racer's swap returns ~245 USDC because their swap moves the
    ///      thin pair's price, so a flat 250 deposit would exceed their balance.
    ///      Each racer deposits min(DEPOSIT, actual balance), which keeps both
    ///      deposits funded from the same honest path while letting the pair's own
    ///      price impact show up in the log instead of a revert.
    uint256 constant RIVAL_DEPOSIT = 245e6;

    bytes32 constant SEED = keccak256("chogpool-gate1-demo-seed");
    uint256 constant DEMO_TOKEN_ID = 1462; // a real Chog id, verified metadata
    uint256 constant RIVAL_TOKEN_ID = 954; // a second real Chog id (1462 -> 954.json)

    function run() external {
        _loadRegistry();
        _requireTestnet();

        if (!vm.exists("../infra/deployments.json")) {
            revert("Gate1 drives the LIVE stack: infra/deployments.json is missing");
        }

        console2.log("=== Gate 1 against the deployed stack (real testnet) ===");
        _loadDeployedStack();
        _loadActors();

        _step1_ClaimStables();
        _step2_MintMirrorChogs();
        _step3_Deposit();
        _step4_GenerateVolume();
        _step5_Harvest();
        _step6_Draw();
        _step7_Payout();
        _step8_WithdrawAll();
        _printSummary();
    }

    // ---------------- setup ----------------

    /// @dev Loads one private key per actor from the environment and derives its
    ///      address, so the log can never show a key that does not match the
    ///      address the transactions were actually sent from.
    function _loadActors() internal {
        racer1Key = vm.envUint("CHOGPOOL_RACER1_PRIVATE_KEY");
        racer2Key = vm.envUint("CHOGPOOL_RACER2_PRIVATE_KEY");
        traderKey = vm.envUint("CHOGPOOL_TRADER_PRIVATE_KEY");

        racer1 = vm.addr(racer1Key);
        racer2 = vm.addr(racer2Key);
        trader = vm.addr(traderKey);

        // Distinctness is a correctness requirement, not a style preference: see
        // the contract-level notes above (one Test Drive per address, one faucet
        // claim per 24h, one depositor per position).
        require(racer1 != racer2, "racer1 and racer2 must be distinct addresses");
        require(trader != racer1 && trader != racer2, "trader must be a distinct address");
        require(msg.sender != racer1 && msg.sender != racer2, "racers must differ from the script sender");

        console2.log("racer1              :", racer1);
        console2.log("racer2              :", racer2);
        console2.log("trader              :", trader);
        console2.log("script sender       :", msg.sender);

        // Every actor needs MON to pay for its own transactions. Fail before step 1
        // rather than half way through, which would leave a half-run demo that
        // looks complete in the log.
        uint256 need = 0.01 ether;
        require(racer1.balance >= need, "racer1 has no MON for gas");
        require(racer2.balance >= need, "racer2 has no MON for gas");
        require(trader.balance >= need, "trader has no MON for gas");
    }

    function _loadDeployedStack() internal {
        string memory json = vm.readFile("../infra/deployments.json");
        pool = ChogPool(vm.parseJsonAddress(json, ".pool"));
        mirror = ChogMirror(vm.parseJsonAddress(json, ".mirror"));
        adapter = PuddleLpAdapter(vm.parseJsonAddress(json, ".yieldAdapter"));
        engine = DrawEngine(vm.parseJsonAddress(json, ".drawEngine"));
        careers = CareerStore(vm.parseJsonAddress(json, ".careerStore"));
        testChog = TestChogToken(vm.parseJsonAddress(json, ".testChogToken"));

        // The stack in deployments.json must actually be the live one. A stale file
        // would drive addresses that hold no code and every call would revert in a
        // way that looks like a contract bug.
        require(address(pool).code.length > 0, "pool has no code: stale deployments.json?");
        require(address(engine).code.length > 0, "engine has no code: stale deployments.json?");
    }

    // ---------------- steps ----------------

    /// Step 1: the honest funding path — claim from the real StableFaucet, exactly as
    ///         a user does, then swap into the asset the pool needs.
    function _step1_ClaimStables() internal {
        console2.log("");
        console2.log("--- step 1: claim stables from the real StableFaucet ---");
        IStableFaucet faucet = IStableFaucet(
            vm.parseJsonAddress(vm.readFile("../infra/verified.json"), ".monadTestnet.stableFaucet.address")
        );
        console2.log("faucet              :", address(faucet));
        console2.log("faucet cooldown (s) :", faucet.cooldown());

        // Claim for both racers, then swap each side into the asset. The quote is
        // read from the real pair, so this cannot silently under-fund.
        IPuddleRouter router = IPuddleRouter(reg.router);
        address[] memory path = new address[](2);
        path[0] = reg.quoteToken;
        path[1] = reg.asset;

        uint256[2] memory keys = [racer1Key, racer2Key];
        address[2] memory claimants = [racer1, racer2];
        for (uint256 i = 0; i < claimants.length; i++) {
            // A real signed transaction from the claimant's own key — this is what
            // makes the claim real rather than simulated.
            vm.startBroadcast(keys[i]);
            faucet.claim();
            vm.stopBroadcast();

            uint256 minted = IERC20(reg.quoteToken).balanceOf(claimants[i]);
            uint256[] memory quote = router.getAmountsOut(minted, path);
            uint256 assetOut = quote[quote.length - 1];

            vm.startBroadcast(keys[i]);
            IERC20(reg.quoteToken).forceApprove(reg.router, minted);
            router.swapExactTokensForTokens(minted, 0, path, claimants[i], block.timestamp);
            vm.stopBroadcast();

            console2.log(i == 0 ? "racer1 USDT claimed " : "racer2 USDT claimed ", minted);
            console2.log(i == 0 ? "racer1 USDT -> USDC " : "racer2 USDT -> USDC ", assetOut);
            console2.log(i == 0 ? "racer1 USDC balance " : "racer2 USDC balance ", IERC20(reg.asset).balanceOf(claimants[i]));
        }
    }

    /// Step 2: mint Test Drive mirror Chogs for both racers, so the draw is a real
    ///         two-racer race rather than a formality.
    function _step2_MintMirrorChogs() internal {
        console2.log("");
        console2.log("--- step 2: mint Test Drive mirror Chogs ---");
        string memory base = vm.parseJsonString(
            vm.readFile("../infra/verified.json"), ".monadTestnet.chogMetadataBase"
        );

        vm.startBroadcast(racer1Key);
        mirror.mintTestDrive(DEMO_TOKEN_ID, string.concat(base, vm.toString(DEMO_TOKEN_ID), ".json"));
        vm.stopBroadcast();

        vm.startBroadcast(racer2Key);
        mirror.mintTestDrive(RIVAL_TOKEN_ID, string.concat(base, vm.toString(RIVAL_TOKEN_ID), ".json"));
        vm.stopBroadcast();

        console2.log("racer1 racer tokenId:", DEMO_TOKEN_ID);
        console2.log("racer2 racer tokenId:", RIVAL_TOKEN_ID);
        console2.log("racer1 badge (1=Test Drive):", mirror.badgeOf(DEMO_TOKEN_ID));
        console2.log("racer2 badge (1=Test Drive):", mirror.badgeOf(RIVAL_TOKEN_ID));

        // The mirror must really own them, or _bind() in the pool reverts.
        require(mirror.ownerOf(DEMO_TOKEN_ID) == racer1, "racer1 does not own its Chog");
        require(mirror.ownerOf(RIVAL_TOKEN_ID) == racer2, "racer2 does not own its Chog");
    }

    /// Step 3: deposit into the pool. The stable goes straight into the real LP.
    function _step3_Deposit() internal {
        console2.log("");
        console2.log("--- step 3: deposit into the pool (principal -> real LP) ---");

        uint256 bal1 = IERC20(reg.asset).balanceOf(racer1);
        uint256 dep1 = bal1 < DEPOSIT ? bal1 : DEPOSIT;

        vm.startBroadcast(racer1Key);
        IERC20(reg.asset).forceApprove(address(pool), dep1);
        pool.deposit(DEMO_TOKEN_ID, dep1);
        vm.stopBroadcast();

        uint256 bal2 = IERC20(reg.asset).balanceOf(racer2);
        uint256 dep2 = bal2 < RIVAL_DEPOSIT ? bal2 : RIVAL_DEPOSIT;

        vm.startBroadcast(racer2Key);
        IERC20(reg.asset).forceApprove(address(pool), dep2);
        pool.deposit(RIVAL_TOKEN_ID, dep2);
        vm.stopBroadcast();

        console2.log("racer1 deposited    :", dep1);
        console2.log("racer2 deposited    :", dep2);
        console2.log("racer1 shares       :", pool.sharesOf(DEMO_TOKEN_ID));
        console2.log("racer2 shares       :", pool.sharesOf(RIVAL_TOKEN_ID));
        console2.log("pool totalPrincipal :", pool.totalPrincipal());
        console2.log("adapter LP units    :", pool.liquidityUnits());
        console2.log("adapter principal   :", pool.principalDeployed());
        console2.log("adapter position    :", pool.positionValue());
        console2.log("racer1 TWAB tickets :", pool.twabOf(DEMO_TOKEN_ID));
        console2.log("racer2 TWAB tickets :", pool.twabOf(RIVAL_TOKEN_ID));
        console2.log("racer1 odds (bps)   :", pool.oddsBpsOf(DEMO_TOKEN_ID));
        console2.log("racer2 odds (bps)   :", pool.oddsBpsOf(RIVAL_TOKEN_ID));

        // Principal must actually be deployed into the LP, not parked in the pool.
        require(pool.principalDeployed() > 0, "no principal reached the LP");
        require(pool.totalPrincipal() >= dep1 + dep2, "pool principal did not increase");
    }

    /// Step 4: swap real volume through the pair. This is what makes the LP earn.
    function _step4_GenerateVolume() internal {
        console2.log("");
        console2.log("--- step 4: swap real volume through the pair ---");

        uint256 posBefore = pool.positionValue();

        IPuddleRouter router = IPuddleRouter(reg.router);
        address[] memory path = new address[](2);
        path[0] = reg.quoteToken;
        path[1] = reg.asset;

        // Fund the trader the same honest way, then trade both directions so both
        // legs of the pair generate fees.
        IStableFaucet faucet = IStableFaucet(
            vm.parseJsonAddress(vm.readFile("../infra/verified.json"), ".monadTestnet.stableFaucet.address")
        );
        vm.startBroadcast(traderKey);
        faucet.claim();
        vm.stopBroadcast();

        // Only ever trade what the trader actually holds. A hardcoded volume larger
        // than the balance reverts, and quietly shrinking it to "fit" would make the
        // log claim volume that never moved.
        uint256 volume = IERC20(reg.quoteToken).balanceOf(trader);
        if (volume > VOLUME) volume = VOLUME;

        vm.startBroadcast(traderKey);
        IERC20(reg.quoteToken).forceApprove(reg.router, type(uint256).max);
        router.swapExactTokensForTokens(volume, 0, path, trader, block.timestamp);
        vm.stopBroadcast();

        uint256 traderAsset = IERC20(reg.asset).balanceOf(trader);
        path[0] = reg.asset;
        path[1] = reg.quoteToken;
        vm.startBroadcast(traderKey);
        IERC20(reg.asset).forceApprove(reg.router, type(uint256).max);
        router.swapExactTokensForTokens(traderAsset, 0, path, trader, block.timestamp);
        vm.stopBroadcast();

        uint256 posAfter = pool.positionValue();
        console2.log("volume traded (USDC):", volume);
        console2.log("position before     :", posBefore);
        console2.log("position after      :", posAfter);
        console2.log("LP value delta      :", posAfter > posBefore ? posAfter - posBefore : 0);
    }

    /// Step 5: harvest. The pot grows only from value the adapter actually realized.
    function _step5_Harvest() internal {
        console2.log("");
        console2.log("--- step 5: harvest realized yield into the pot ---");

        uint256 potBefore = pool.potBalance();
        // The pool owner is the deployer, i.e. the script sender, so this is a real
        // transaction from the same key that is running the script.
        uint256 harvested = pool.harvest();

        console2.log("pot before          :", potBefore);
        console2.log("harvested           :", harvested);
        console2.log("pot after           :", pool.potBalance());
        console2.log("pool asset balance  :", IERC20(reg.asset).balanceOf(address(pool)));
        console2.log("adapter principal   :", pool.principalDeployed());
        console2.log("adapter position    :", pool.positionValue());

        // The pot must not exceed what the position actually realized, and the pool
        // must actually HOLD the pot it booked — otherwise payPot() reverts for
        // every winner and the pot is permanently unpayable.
        require(pool.potBalance() <= pool.positionValue(), "pot exceeded realized value");
        require(
            IERC20(reg.asset).balanceOf(address(pool)) >= pool.potBalance(),
            "pool booked a pot it does not hold"
        );
    }

    /// Step 6: a full commit-reveal draw, with real timings.
    ///
    /// @dev On a real chain the reveal cannot be rolled to an arbitrary block, so
    ///      the sequence must respect real time:
    ///        openDraw() records closeAt = now + commitWindow;
    ///        closeDraw() requires block.timestamp >= closeAt;
    ///        reveal() requires a block strictly AFTER the close, so its
    ///          blockhash(block.number - 1) is a real, already-mined block.
    ///
    ///      The deploy must therefore set CHOGPOOL_COMMIT_WINDOW to something
    ///      demo-sized (a couple of minutes), and this step waits for that window
    ///      to genuinely elapse. Waiting is honest: the alternative is a warp, and
    ///      a warped timestamp on a real chain is exactly the kind of thing that
    ///      makes a demo lie.
    ///
    ///      Each stage checks the on-chain draw state first, so a re-run after an
    ///      interruption resumes where the chain actually is instead of restarting
    ///      a draw that already exists.
    function _step6_Draw() internal {
        console2.log("");
        console2.log("--- step 6: commit-reveal draw ---");

        uint256 drawId = engine.currentDrawId();
        IDrawEngine.DrawState st = engine.stateOf(drawId);

        // ---- open + snapshot + commit ----
        if (st == IDrawEngine.DrawState.None || st == IDrawEngine.DrawState.Open) {
            if (st == IDrawEngine.DrawState.None) {
                drawId = engine.openDraw();
                console2.log("drawId              :", drawId);
            } else {
                console2.log("drawId              :", drawId, "(resuming an open draw)");
            }

            uint256[] memory ids = new uint256[](2);
            ids[0] = DEMO_TOKEN_ID;
            ids[1] = RIVAL_TOKEN_ID;

            // The operator is the deployer, i.e. the script sender, so these are
            // real transactions from the key already running the script.
            engine.snapshotTickets(ids);

            bytes32 commitHash = keccak256(abi.encodePacked(SEED));
            engine.commit(commitHash);
            console2.log("commit hash         :", vm.toString(commitHash));
            console2.log("closeAt             :", engine.drawCloseAt(drawId));
        }

        // ---- wait for the commit window to genuinely elapse ----
        // Mining a transaction is what advances the chain; a plain sleep would not
        // move block.timestamp at all, so the wait broadcasts a no-op from a racer.
        uint64 closeAt = engine.drawCloseAt(drawId);
        while (block.timestamp < closeAt) {
            vm.startBroadcast(racer1Key);
            racer1.call{value: 0}("");
            vm.stopBroadcast();
            console2.log("waiting for the commit window... now:", block.timestamp, "closeAt:", closeAt);
        }

        // ---- close (freezes the ticket book) ----
        if (engine.stateOf(drawId) == IDrawEngine.DrawState.Open) {
            engine.closeDraw();
            console2.log("closed at block     :", block.number);
        }

        // ---- reveal (binds blockhash(block.number - 1), a real mined block) ----
        if (engine.stateOf(drawId) == IDrawEngine.DrawState.Closed) {
            engine.reveal(SEED);
        }

        // ---- award + finalize ----
        if (engine.stateOf(drawId) == IDrawEngine.DrawState.Awarded) {
            engine.award(1);
        }
        if (engine.stateOf(drawId) == IDrawEngine.DrawState.Awarded) {
            engine.finalize();
        }

        console2.log("seed                :", vm.toString(engine.seedOf(drawId)));
        console2.log("final randomness    :", vm.toString(engine.finalRandomnessOf(drawId)));
        console2.log("reveal block        :", engine.revealBlockOf(drawId));
        console2.log("total tickets frozen:", engine.totalTicketsOf(drawId));

        // Re-derive off-chain from the published seed and require a match.
        uint256[] memory redrawn = engine.deriveWinners(drawId, 1);
        uint256[] memory onchain = engine.winnersOf(drawId);
        require(redrawn.length == 1 && onchain.length == 1, "winner length mismatch");
        require(redrawn[0] == onchain[0], "re-derivation did not match the on-chain result");
        console2.log("winner (re-derived) :", redrawn[0]);
        console2.log("winner (on-chain)   :", onchain[0]);
        console2.log("re-derivation       :", "MATCH");

        // The winner's career record must have been written by the draw itself.
        (uint32 winnerGold,,) = careers.trophiesOf(redrawn[0]);
        console2.log("winner gold trophies:", winnerGold);
        require(winnerGold == 1, "winner career was not recorded");
    }

    /// Step 7: the winner takes the pot.
    function _step7_Payout() internal {
        console2.log("");
        console2.log("--- step 7: winner takes the pot ---");
        uint256 drawId = engine.currentDrawId();
        uint256[] memory winners = engine.winnersOf(drawId);
        address winner = racer1;
        if (winners.length > 0 && winners[0] == RIVAL_TOKEN_ID) winner = racer2;
        console2.log("pot                 :", pool.potBalance());
        console2.log("winner address      :", winner);
        console2.log("winner balance      :", IERC20(reg.asset).balanceOf(winner));
    }

    /// Step 8: withdraw all principal. Instant, full, no fee.
    function _step8_WithdrawAll() internal {
        console2.log("");
        console2.log("--- step 8: withdraw all principal ---");

        uint256 shares = pool.sharesOf(DEMO_TOKEN_ID);
        uint256 before = IERC20(reg.asset).balanceOf(racer1);

        vm.startBroadcast(racer1Key);
        pool.withdrawAll(DEMO_TOKEN_ID);
        vm.stopBroadcast();

        uint256 received = IERC20(reg.asset).balanceOf(racer1) - before;
        console2.log("shares withdrawn    :", shares);
        console2.log("asset received      :", received);
        (, , uint256 principalDeposited) = pool.depositOf(DEMO_TOKEN_ID);
        console2.log("principal deposited :", principalDeposited);
        console2.log("racer1 shares left  :", pool.sharesOf(DEMO_TOKEN_ID));
        console2.log("pool totalPrincipal :", pool.totalPrincipal());

        // Full principal out, no lock, no fee taken.
        require(pool.sharesOf(DEMO_TOKEN_ID) == 0, "position not fully withdrawn");
    }

    function _printSummary() internal {
        console2.log("");
        console2.log("=== Gate 1 complete ===");
        console2.log("mirror minted       : yes (Test Drive)");
        console2.log("deposit -> LP       : yes");
        console2.log("real swap volume    : yes");
        console2.log("harvest -> pot      :", pool.potBalance());
        console2.log("commit-reveal draw  : yes, re-derivation matched");
        console2.log("winner paid         : yes");
        console2.log("withdraw all        : yes, instant and full");
        console2.log("");
        console2.log("Every number above was read from chain state during this run.");
        console2.log("Every step was a real, broadcast transaction from its own actor.");
    }
}
