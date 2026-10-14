// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IDrawEngine — frozen contract between contracts/ and web/ (2026-10-14).
/// @notice FROZEN INTERFACE. Changing anything here requires BOTH owners to approve.
///
/// Draw lifecycle: Open -> Closed -> Awarded -> Finalized.
///
/// Fairness (docs/RULES.md #5): commit-reveal. The operator commits keccak256(seed)
/// while the draw is Open, then reveals `seed` after close; the final randomness is
/// keccak256(commitSeed, blockhash(revealBlock), previousDrawNumber). Anyone can
/// re-derive the winner off-chain from the published seed — /verify does exactly this.
///
/// Winner check per racer:
///   keccak256(drawId, tokenId, tier, packedParams, finalRandomness) % totalTickets
///     < winningZone(tokenId, tier)
/// where winningZone = tierOdds × twab × traitBoost, boost capped at +25% (scale 1e18).
interface IDrawEngine {
    // ---------- lifecycle ----------

    enum DrawState {
        None,
        Open,
        Closed,
        Awarded,
        Finalized
    }

    // ---------- events ----------

    event DrawOpened(uint256 indexed drawId, uint64 openAt, uint64 closeAt);
    event DrawClosed(uint256 indexed drawId, uint64 closedAt);
    event Committed(uint256 indexed drawId, bytes32 commitHash);
    event Revealed(uint256 indexed drawId, bytes32 seed, bytes32 finalRandomness, uint256 revealBlock);
    event DrawAwarded(uint256 indexed drawId, uint256[] winnerTokenIds, uint256 potPerWinner);
    event DrawFinalized(uint256 indexed drawId);

    // ---------- errors ----------

    error NotOperator();
    error NotPool();
    error WrongState(DrawState expected, DrawState actual);
    error CommitWindowClosed();
    error RevealTooEarly();
    error RevealDeadlinePassed();
    error BadReveal(bytes32 commitHash, bytes32 recomputed);
    error NoTickets();
    error NoWinners();
    error RevealBlockUnavailable();
    error BoostOutOfRange(uint256 boost);
    error ZeroTickets();

    // ---------- configuration ----------

    function pool() external view returns (address);
    function operator() external view returns (address);
    function currentDrawId() external view returns (uint256);
    function nextDrawAt() external view returns (uint64);
    function revealDeadline() external view returns (uint64);
    function commitWindow() external view returns (uint64);

    // ---------- lifecycle operations ----------

    /// @notice Open a new draw. Callable by the operator when no draw is active.
    function openDraw() external returns (uint256 drawId);

    /// @notice Close the current draw. Tickets are frozen from here.
    function closeDraw() external;

    /// @notice Commit keccak256(seed) while the draw is Open.
    function commit(bytes32 commitHash) external;

    /// @notice Reveal the seed after close; binds blockhash(revealBlock) as randomness.
    function reveal(bytes32 seed) external;

    /// @notice Determine winners from the final randomness and pay the pot.
    /// @param winnerCount how many winners this draw pays
    function award(uint256 winnerCount) external;

    /// @notice Finalize: the draw is over, results are on-chain and re-verifiable.
    function finalize() external;

    // ---------- views ----------

    function stateOf(uint256 drawId) external view returns (DrawState);

    /// @notice The commit hash recorded for a draw (bytes32(0) if not committed).
    function commitOf(uint256 drawId) external view returns (bytes32);

    /// @notice The revealed seed for a draw (bytes32(0) if not revealed).
    function seedOf(uint256 drawId) external view returns (bytes32);

    /// @notice The final randomness for a draw (bytes32(0) if not revealed).
    function finalRandomnessOf(uint256 drawId) external view returns (bytes32);

    /// @notice The block whose blockhash is bound into the final randomness.
    function revealBlockOf(uint256 drawId) external view returns (uint256);

    /// @notice The draw number used in the randomness derivation for a draw.
    function drawNumber(uint256 drawId) external view returns (uint256);

    /// @notice Winners recorded on-chain for a draw.
    function winnersOf(uint256 drawId) external view returns (uint256[] memory);

    /// @notice Asset amount paid to each winner of a draw.
    function potPerWinnerOf(uint256 drawId) external view returns (uint256);

    /// @notice Total tickets across all racers in a draw (frozen at close).
    function totalTicketsOf(uint256 drawId) external view returns (uint256);

    /// @notice A racer's ticket count in a draw (frozen at close).
    function ticketsOf(uint256 drawId, uint256 tokenId) external view returns (uint256);

    /// @notice A racer's win probability in basis points (0..10000) for a draw.
    function oddsBpsOf(uint256 drawId, uint256 tokenId) external view returns (uint256);

    // ---------- fairness ----------

    /// @notice Set a racer's trait boost, in 1e18 fixed point, capped at +25%.
    /// @dev Only the operator may set this; it is derived from real IPFS traits by the
    ///      off-chain indexer and is explicitly labeled "our design" in the UI.
    function setTraitBoost(uint256 tokenId, uint256 tier, uint256 boost) external;

    /// @notice Read a racer's winning zone (tickets) for a draw, including the boost.
    function winningZone(uint256 tokenId, uint256 tier, uint256 twab) external view returns (uint256);

    /// @notice Pure re-derivation used by /verify: recompute a draw's winner from the seed.
    /// @return winnerTokenIds the tokenIds that won, in payout order
    function deriveWinners(uint256 drawId, uint256 winnerCount) external view returns (uint256[] memory winnerTokenIds);
}
