// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDrawEngine} from "../interfaces/IDrawEngine.sol";
import {IChogPool} from "../interfaces/IChogPool.sol";
import {ICareerStore} from "../interfaces/ICareerStore.sol";

/// @title DrawEngine — commit-reveal draw with a published, re-verifiable seed.
/// @notice Production implementation of the FROZEN IDrawEngine interface.
///
/// Fairness (docs/RULES.md #5):
///  1. While a draw is Open, the operator commits keccak256(seed). The seed itself is
///     NOT on-chain, so nobody can read it early.
///  2. After close, the operator reveals `seed`; the contract checks keccak256(seed)==commit.
///  3. Final randomness = keccak256(commitSeed, blockhash(revealBlock), previousDrawNumber).
///     The reveal block's blockhash is not knowable at commit time, so the operator
///     cannot grind the seed to a chosen winner.
///  4. Winners are derived on-chain from that randomness and the frozen TWAB tickets.
///     Anyone can re-derive them off-chain from the published seed — /verify does this.
///
/// Modulo bias: the winner index is drawn from a 2^256 space via the draw's randomness,
/// reduced modulo totalTickets. Because totalTickets is a real number (not a power of
/// two) there is a theoretical bias of at most totalTickets/2^256, which is
/// unmeasurable (< 1e-70 for any realistic ticket count). This is documented rather
/// than hidden, and the fuzz suite asserts the distribution is uniform in practice.
contract DrawEngine is IDrawEngine, Ownable2Step, ReentrancyGuard {
    // ---------------- constants ----------------

    /// @dev Trait boost is capped at +25% (scale 1e18 fixed point).
    uint256 public constant MAX_BOOST = 0.25e18;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @dev The operator is an access-control role, so a rotation must be visible
    ///      off-chain. Declared here rather than in the frozen IDrawEngine because
    ///      adding to a frozen interface needs both owners' approval.
    event OperatorUpdated(address indexed newOperator);

    /// @dev Raised when a wiring target has no code — see setCareerStore.
    error NotAContract(address target);

    // ---------------- immutables / wiring ----------------

    /// @inheritdoc IDrawEngine
    address public pool;
    /// @inheritdoc IDrawEngine
    address public operator;
    address public careerStore;

    // ---------------- state ----------------

    struct Draw {
        DrawState state;
        uint64 openAt;
        uint64 closeAt;
        /// @dev Block at which the draw closed; the reveal must happen in a LATER
        ///      block so its blockhash is unknowable at commit time.
        uint256 closedAtBlock;
        bytes32 commitHash;
        bytes32 seed;
        bytes32 finalRandomness;
        uint256 revealBlock;
        uint256 totalTickets;
        uint256 potPerWinner;
        uint256[] winners;
        /// @dev tokenId => tickets frozen at close.
        mapping(uint256 => uint256) tickets;
        /// @dev tokenId => (tier, boost) recorded for the draw.
        mapping(uint256 => TierBoost) boosts;
    }

    struct TierBoost {
        uint32 tier;
        uint256 boost; // 1e18 fixed point, <= MAX_BOOST
    }

    mapping(uint256 => Draw) private _draws;

    /// @inheritdoc IDrawEngine
    uint256 public currentDrawId;
    /// @inheritdoc IDrawEngine
    uint64 public nextDrawAt;
    /// @inheritdoc IDrawEngine
    uint64 public revealDeadline;
    /// @inheritdoc IDrawEngine
    uint64 public commitWindow = 6 hours;

    /// @dev How long after close the operator has to reveal. Miss it and the draw
    ///      cannot be settled — the honest outcome is an unplayable draw, not a
    ///      quietly rewritten result.
    uint64 public revealWindow = 24 hours;

    /// @dev Trait boosts are keyed by tokenId and apply to the next draw.
    mapping(uint256 => TierBoost) public boostOf;

    // ---------------- construction ----------------

    constructor(address owner_, address operator_) Ownable(owner_) {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
    }

    // ---------------- wiring ----------------

    function setPool(address pool_) external onlyOwner {
        if (pool_ == address(0)) revert ZeroAddress();
        pool = pool_;
    }

    function setCareerStore(address careerStore_) external onlyOwner {
        // A career store with no code would make award() revert on every draw,
        // bricking the draw: no pot paid, no winners recorded, stuck in Awarded.
        // Catch it at wiring time where the failure is obvious and fixable, rather
        // than mid-draw where the pot is already locked up.
        if (careerStore_.code.length == 0) revert NotAContract(careerStore_);
        careerStore = careerStore_;
    }

    function setOperator(address operator_) external onlyOwner {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorUpdated(operator_);
    }

    function setCommitWindow(uint64 window) external onlyOwner {
        commitWindow = window;
    }

    function setRevealWindow(uint64 window) external onlyOwner {
        revealWindow = window;
    }

    // ---------------- lifecycle ----------------

    /// @inheritdoc IDrawEngine
    function openDraw() external returns (uint256 drawId) {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();

        uint256 prevId = currentDrawId;
        if (prevId != 0) {
            Draw storage prev = _draws[prevId];
            if (prev.state != DrawState.Finalized && prev.state != DrawState.None) {
                revert WrongState(DrawState.Finalized, prev.state);
            }
        }

        drawId = prevId + 1;
        Draw storage d = _draws[drawId];
        d.state = DrawState.Open;
        d.openAt = uint64(block.timestamp);
        d.closeAt = uint64(block.timestamp) + commitWindow;

        currentDrawId = drawId;
        nextDrawAt = d.closeAt;

        // Tell the pool when the next draw is, so the UI can count down.
        if (pool != address(0)) {
            IChogPool(pool).setNextDrawAt(d.closeAt);
        }

        emit DrawOpened(drawId, d.openAt, d.closeAt);
    }

    /// @inheritdoc IDrawEngine
    function closeDraw() external {
        _requireOperatorOrOwner();
        Draw storage d = _draws[currentDrawId];
        if (d.state != DrawState.Open) revert WrongState(DrawState.Open, d.state);
        if (block.timestamp < d.closeAt) revert CommitWindowClosed();

        d.state = DrawState.Closed;
        // Record the closing block so reveal() can require a strictly later one.
        d.closedAtBlock = block.number;
        // The reveal must land inside the reveal window, or the draw is dead.
        revealDeadline = uint64(block.timestamp) + revealWindow;

        // Freeze the ticket book from the pool's TWAB so odds cannot move afterwards.
        _freezeTickets(d);

        emit DrawClosed(currentDrawId, uint64(block.timestamp));
    }

    /// @dev Snapshot every racer's TWAB as their ticket count. The racer set is
    ///      supplied by the operator (an off-chain indexer enumerates live positions);
    ///      the ticket COUNTS come from the pool, so the operator cannot inflate anyone.
    function _freezeTickets(Draw storage d) internal {
        if (pool == address(0)) revert ZeroAddress();
        // The pool exposes the frozen book via ticketsOfFrozen; we snapshot it here
        // into the draw so the draw is self-contained for /verify.
        uint256 drawId = currentDrawId;
        // Read the pool's live totals: the operator has already called
        // pool.freezeTickets(drawId, tokenIds) before closeDraw in the deploy script.
        // Here we mirror the totals so the draw is independently re-derivable.
        uint256 total = IChogPool(pool).totalTicketsOfFrozen(drawId);
        d.totalTickets = total;
        if (total == 0) revert NoTickets();
    }

    /// @notice Operator snapshots the ticket book for the current draw.
    /// @dev Must be called BEFORE closeDraw, so the pool freezes TWAB at a known time.
    function snapshotTickets(uint256[] calldata tokenIds) external {
        _requireOperatorOrOwner();
        Draw storage d = _draws[currentDrawId];
        if (d.state != DrawState.Open) revert WrongState(DrawState.Open, d.state);
        if (pool == address(0)) revert ZeroAddress();

        IChogPool(pool).freezeTickets(currentDrawId, tokenIds);

        // Copy the per-racer tickets into the draw so /verify needs only this contract.
        uint256 total = 0;
        uint256 len = tokenIds.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 tokenId = tokenIds[i];
            uint256 t = IChogPool(pool).ticketsOfFrozen(currentDrawId, tokenId);
            if (t == 0) continue;
            d.tickets[tokenId] = t;
            TierBoost storage tb = d.boosts[tokenId];
            TierBoost storage global = boostOf[tokenId];
            tb.tier = global.tier;
            tb.boost = global.boost;
            total += t;
        }
        d.totalTickets = total;
    }

    /// @inheritdoc IDrawEngine
    function commit(bytes32 commitHash) external {
        _requireOperatorOrOwner();
        Draw storage d = _draws[currentDrawId];
        if (d.state != DrawState.Open) revert WrongState(DrawState.Open, d.state);
        if (block.timestamp > d.closeAt) revert CommitWindowClosed();
        if (commitHash == bytes32(0)) revert BadReveal(commitHash, bytes32(0));

        d.commitHash = commitHash;
        emit Committed(currentDrawId, commitHash);
    }

    /// @inheritdoc IDrawEngine
    function reveal(bytes32 seed) external {
        _requireOperatorOrOwner();
        uint256 drawId = currentDrawId;
        Draw storage d = _draws[drawId];
        if (d.state != DrawState.Closed) revert WrongState(DrawState.Closed, d.state);
        if (d.commitHash == bytes32(0)) revert BadReveal(bytes32(0), bytes32(0));
        if (keccak256(abi.encodePacked(seed)) != d.commitHash) {
            revert BadReveal(d.commitHash, keccak256(abi.encodePacked(seed)));
        }
        if (block.timestamp > revealDeadline) revert RevealDeadlinePassed();

        // Bind the reveal block's blockhash: unknowable at commit time, and also
        // unknowable at close time. The reveal must land in a strictly LATER block
        // than the close, otherwise the operator could commit and reveal in the
        // same block with full knowledge of the randomness.
        //
        // We bind blockhash(block.number - 1), the PREVIOUS block, because EVM
        // `blockhash(n)` is defined as zero when n is the current block. Binding
        // the current block would bind a constant zero and contribute nothing to
        // the randomness — the whole point of the binding is to fold in a value
        // the operator cannot choose.
        if (block.number <= d.closedAtBlock) revert RevealTooEarly();

        uint256 revealBlock = block.number - 1;
        if (revealBlock <= d.closedAtBlock) revert RevealTooEarly();
        bytes32 revealBlockHash = blockhash(revealBlock);
        if (revealBlockHash == bytes32(0)) revert RevealBlockUnavailable();

        bytes32 finalRandomness = keccak256(
            abi.encodePacked(seed, revealBlockHash, drawId)
        );

        d.seed = seed;
        d.finalRandomness = finalRandomness;
        d.revealBlock = revealBlock;
        d.state = DrawState.Awarded;

        emit Revealed(drawId, seed, finalRandomness, revealBlock);
    }

    /// @inheritdoc IDrawEngine
    function award(uint256 winnerCount) external {
        _requireOperatorOrOwner();
        if (winnerCount == 0) revert NoWinners();
        uint256 drawId = currentDrawId;
        Draw storage d = _draws[drawId];
        if (d.state != DrawState.Awarded) revert WrongState(DrawState.Awarded, d.state);
        if (d.totalTickets == 0) revert NoTickets();
        if (d.winners.length != 0) revert NoWinners();

        uint256[] memory winners = _deriveWinners(d, d.finalRandomness, winnerCount);
        for (uint256 i = 0; i < winners.length; i++) {
            d.winners.push(winners[i]);
        }

        // Pay the pot, split evenly across winners.
        if (pool != address(0)) {
            uint256 pot = IChogPool(pool).potBalance();
            if (pot > 0) {
                d.potPerWinner = pot / winners.length;
                for (uint256 i = 0; i < winners.length; i++) {
                    address winnerOwner = _ownerOfWinner(winners[i]);
                    IChogPool(pool).payPot(winnerOwner, d.potPerWinner);
                }
            }
        }

        // Record careers for every winner (placement 1..N).
        if (careerStore != address(0)) {
            for (uint256 i = 0; i < winners.length; i++) {
                ICareerStore(careerStore).recordRace(winners[i], drawId, uint8(i + 1), _fatigueDelta(i));
            }
        }

        emit DrawAwarded(drawId, d.winners, d.potPerWinner);
    }

    /// @inheritdoc IDrawEngine
    function finalize() external {
        _requireOperatorOrOwner();
        Draw storage d = _draws[currentDrawId];
        if (d.state != DrawState.Awarded) revert WrongState(DrawState.Awarded, d.state);
        d.state = DrawState.Finalized;

        // Clearing nextDrawAt is what keeps the countdown honest. Draws are opened
        // by the operator, not by a schedule, so after a finalize there is genuinely
        // no next draw yet. Leaving the closed draw's closeAt in place makes the
        // landing-page countdown read as expired forever, which invites the reader
        // to believe a cadence exists that does not. Zero is the truthful value and
        // the UI renders it as "not scheduled yet".
        nextDrawAt = 0;
        if (pool != address(0)) {
            IChogPool(pool).setNextDrawAt(0);
        }

        emit DrawFinalized(currentDrawId);
    }

    // ---------------- winner derivation ----------------

    /// @dev Deterministic: same draw + same randomness + same ticket book => same winners.
    ///      Duplicate winners are skipped (a tokenId already in the list is not re-picked),
    ///      so `winnerCount` distinct racers win whenever the book is large enough.
    /// @dev Reads ONLY the draw's frozen snapshot (tickets + boosts), never the live
    ///      `boostOf` mapping, so a boost changed after close cannot alter the result
    ///      and an off-chain re-derivation from the published seed matches exactly.
    function _deriveWinners(Draw storage d, bytes32 randomness, uint256 winnerCount)
        internal
        view
        returns (uint256[] memory winners)
    {
        // The racer set for a draw is the tokens with non-zero tickets. We keep the
        // list in the draw so derivation is self-contained.
        uint256[] memory racers = _racerSet(d);
        uint256 n = racers.length;
        if (n == 0) revert NoTickets();
        if (winnerCount > n) winnerCount = n;

        winners = new uint256[](winnerCount);
        uint256[] memory picked = new uint256[](n);
        uint256 pickedCount = 0;

        for (uint256 i = 0; i < winnerCount; i++) {
            // Derive a fresh index per winner from the draw randomness + attempt index.
            bytes32 h = keccak256(abi.encodePacked(randomness, i));
            uint256 idx = uint256(h) % d.totalTickets;
            uint256 tokenId = _tokenAtCumulativeIndex(d, racers, idx);
            // Skip duplicates.
            bool dup = false;
            for (uint256 j = 0; j < pickedCount; j++) {
                if (picked[j] == tokenId) {
                    dup = true;
                    break;
                }
            }
            if (dup) {
                // Walk forward deterministically to the next unpicked racer.
                for (uint256 k = 0; k < n; k++) {
                    uint256 cand = racers[(uint256(h) + k) % n];
                    bool isDup = false;
                    for (uint256 j = 0; j < pickedCount; j++) {
                        if (picked[j] == cand) {
                            isDup = true;
                            break;
                        }
                    }
                    if (!isDup) {
                        tokenId = cand;
                        break;
                    }
                }
            }
            winners[i] = tokenId;
            picked[pickedCount++] = tokenId;
        }
    }

    /// @dev Map a flat index in [0, totalTickets) to a tokenId by cumulative tickets.
    function _tokenAtCumulativeIndex(Draw storage d, uint256[] memory racers, uint256 idx)
        internal
        view
        returns (uint256)
    {
        uint256 acc = 0;
        for (uint256 i = 0; i < racers.length; i++) {
            uint256 t = d.tickets[racers[i]];
            if (t == 0) continue;
            acc += t;
            if (idx < acc) return racers[i];
        }
        // Should be unreachable when idx < totalTickets.
        return racers[racers.length - 1];
    }

    /// @dev The racer set for a draw: every tokenId that has tickets recorded.
    ///      The pool is the source of truth for WHICH tokens have tickets, so we
    ///      read the frozen book back rather than tracking a set ourselves.
    function _racerSet(Draw storage) internal view returns (uint256[] memory) {
        return IChogPool(pool).frozenRacers(currentDrawId);
    }

    /// @inheritdoc IDrawEngine
    function deriveWinners(uint256 drawId, uint256 winnerCount) external view returns (uint256[] memory) {
        Draw storage d = _draws[drawId];
        if (d.finalRandomness == bytes32(0)) revert NoWinners();
        return _deriveWinners(d, d.finalRandomness, winnerCount);
    }

    // ---------------- views ----------------

    /// @inheritdoc IDrawEngine
    function stateOf(uint256 drawId) external view returns (DrawState) {
        return _draws[drawId].state;
    }

    /// @inheritdoc IDrawEngine
    function commitOf(uint256 drawId) external view returns (bytes32) {
        return _draws[drawId].commitHash;
    }

    /// @inheritdoc IDrawEngine
    function seedOf(uint256 drawId) external view returns (bytes32) {
        return _draws[drawId].seed;
    }

    /// @inheritdoc IDrawEngine
    function finalRandomnessOf(uint256 drawId) external view returns (bytes32) {
        return _draws[drawId].finalRandomness;
    }

    /// @inheritdoc IDrawEngine
    function revealBlockOf(uint256 drawId) external view returns (uint256) {
        return _draws[drawId].revealBlock;
    }

    /// @inheritdoc IDrawEngine
    function drawNumber(uint256 drawId) external pure returns (uint256) {
        return drawId;
    }

    /// @notice The block-timestamp at which a draw's commit window ends.
    /// @dev Declared HERE rather than in IDrawEngine because adding to a frozen
    ///      interface needs both owners' approval, and a live Gate 1 run needs to
    ///      know when it may honestly call closeDraw(): closeDraw() reverts
    ///      CommitWindowClosed while block.timestamp < closeAt, and a real chain
    ///      cannot be warped past it. The value is already stored in the draw and
    ///      already emitted in DrawOpened, so this exposes nothing new — it only
    ///      makes an existing value readable without an event scan.
    function drawCloseAt(uint256 drawId) external view returns (uint64) {
        return _draws[drawId].closeAt;
    }

    /// @inheritdoc IDrawEngine
    function winnersOf(uint256 drawId) external view returns (uint256[] memory) {
        return _draws[drawId].winners;
    }

    /// @inheritdoc IDrawEngine
    function potPerWinnerOf(uint256 drawId) external view returns (uint256) {
        return _draws[drawId].potPerWinner;
    }

    /// @inheritdoc IDrawEngine
    function totalTicketsOf(uint256 drawId) external view returns (uint256) {
        return _draws[drawId].totalTickets;
    }

    /// @inheritdoc IDrawEngine
    function ticketsOf(uint256 drawId, uint256 tokenId) external view returns (uint256) {
        return _draws[drawId].tickets[tokenId];
    }

    /// @inheritdoc IDrawEngine
    function oddsBpsOf(uint256 drawId, uint256 tokenId) external view returns (uint256) {
        Draw storage d = _draws[drawId];
        if (d.totalTickets == 0) return 0;
        uint256 zone = winningZone(tokenId, d.boosts[tokenId].tier, d.tickets[tokenId]);
        return (zone * BPS_DENOMINATOR) / d.totalTickets;
    }

    /// @inheritdoc IDrawEngine
    function setTraitBoost(uint256 tokenId, uint256 tier, uint256 boost) external {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        if (boost > MAX_BOOST) revert BoostOutOfRange(boost);
        boostOf[tokenId] = TierBoost({tier: uint32(tier), boost: boost});
    }

    /// @inheritdoc IDrawEngine
    /// @dev winningZone = tierOdds × twab × (1 + boost), with the boost capped.
    ///      tierOdds is the racer's base odds from their real trait tier; it is our
    ///      design layer on real metadata, labeled as such in the UI.
    function winningZone(uint256 tokenId, uint256 tier, uint256 twab) public view returns (uint256) {
        uint256 tickets = twab;
        if (tickets == 0) return 0;
        TierBoost storage tb = boostOf[tokenId];
        // The boost only counts for the tier it was recorded against, so a re-tier
        // cannot silently stack a stale boost on top.
        if (tb.tier != tier) return tickets;
        // zone = tickets + tickets × boost  (boost in 1e18)
        return tickets + (tickets * tb.boost) / WAD;
    }

    // ---------------- internal helpers ----------------

    function _requireOperatorOrOwner() internal view {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
    }

    function _ownerOfWinner(uint256 tokenId) internal view returns (address) {
        if (pool == address(0)) return address(0);
        (address depositor,,) = IChogPool(pool).depositOf(tokenId);
        return depositor;
    }

    function _fatigueDelta(uint256 placement) internal pure returns (int256) {
        // Wins add fatigue (the Champion's Burden); placement 1 hurts most.
        if (placement == 0) return int256(0.1e18);
        if (placement <= 3) return int256(0.05e18);
        return 0;
    }
}
