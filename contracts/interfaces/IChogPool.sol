// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IChogPool — frozen contract between contracts/ and web/ (2026-10-14).
/// @notice FROZEN INTERFACE. Changing anything here requires BOTH owners to approve.
///
/// Design invariants (from PLAN.md Phase 1 item 4):
///  - Deposit is denominated in a single stable (PuddleSwap core USDC on testnet,
///    mainnet USDC in production) resolved from infra/verified.json.
///  - Per-Depositor accounting is keyed by the Chog tokenId bound at deposit, so one
///    wallet may hold several Chogs, each with its own book.
///  - Instant FULL principal withdrawal: no lock, no fee. Principal is never at risk.
///  - Odds are time-weighted (TWAB), not last-second snapshot, so sniping cannot win.
///  - The pot only grows from value REALIZED through actual removeLiquidity/swap
///    transactions (see IYieldAdapter) — never from a paper calculation.
interface IChogPool {
    // ---------- events ----------

    event Deposited(uint256 indexed tokenId, address indexed depositor, uint256 amount, uint256 sharesMinted);
    event Withdrawn(uint256 indexed tokenId, address indexed to, uint256 sharesBurned, uint256 amount);
    event PotIncreased(uint256 amount, uint256 newPotBalance);
    event YieldHarvested(address indexed adapter, uint256 amount);
    /// @dev Emitted when the yield target is moved (deployment wiring).
    event AdapterUpdated(address indexed oldAdapter, address indexed newAdapter);

    // ---------- errors ----------

    error ZeroAmount();
    error ZeroAddress();
    error NotMirrorOwner(uint256 tokenId, address caller);
    error InsufficientShares(uint256 tokenId, uint256 requested, uint256 available);
    error InsufficientPot(uint256 requested, uint256 available);
    error AlreadyBound(uint256 tokenId);
    error NotBound(uint256 tokenId);
    error WindowTooLong(uint256 requested, uint256 maxWindow);
    error InvalidTimeRange(uint256 from, uint256 to);

    // ---------- configuration ----------

    /// @notice The stable token accepted for deposits (registry-resolved).
    function asset() external view returns (address);

    /// @notice The yield adapter holding principal (registry-resolved at deploy).
    function yieldAdapter() external view returns (address);

    /// @notice The mirror NFT contract whose tokenIds key positions.
    function mirror() external view returns (address);

    /// @notice The draw engine that consumes TWAB odds and pays out the pot.
    function drawEngine() external view returns (address);

    /// @notice Unix timestamp of the next draw (0 when no draw is scheduled).
    function nextDrawAt() external view returns (uint64);

    /// @notice Let the draw engine publish when the next draw closes, so the UI can
    ///         count down from a single on-chain source.
    function setNextDrawAt(uint64 at) external;

    // ---------- deposits / withdrawals ----------

    /// @notice Deposit `amount` of the stable, bound to Chog `tokenId`.
    /// @dev Caller must own `tokenId` in the mirror contract. Pulls `amount` via
    ///      transferFrom and forwards it to the yield adapter. Mints shares.
    /// @param tokenId the Chog tokenId this position is bound to
    /// @param amount  the stable amount (asset decimals)
    function deposit(uint256 tokenId, uint256 amount) external;

    /// @notice Withdraw a specific number of shares; principal comes back instantly.
    function withdraw(uint256 tokenId, uint256 shares) external;

    /// @notice Withdraw ALL shares for `tokenId`; principal comes back instantly.
    function withdrawAll(uint256 tokenId) external;

    // ---------- views ----------

    /// @notice Total shares issued across all tokenIds.
    function totalShares() external view returns (uint256);

    /// @notice Total principal deposited (asset units) — excludes pot.
    function totalPrincipal() external view returns (uint256);

    /// @notice Current prize pot (asset units). Grew only from realized yield.
    function potBalance() external view returns (uint256);

    /// @notice Shares held for `tokenId`.
    function sharesOf(uint256 tokenId) external view returns (uint256);

    /// @notice The Chog tokenId bound to a position, and the depositor address.
    function depositOf(uint256 tokenId)
        external
        view
        returns (address depositor, uint256 shares, uint256 principal);

    /// @notice Time-weighted average balance of `tokenId` over [from, to].
    /// @dev Standard ring-buffer TWAB: cumulative = lastCumulative + lastBalance × Δt;
    ///      average = Δcumulative / Δt. Both timestamps must be <= now and ordered.
    function twabOf(uint256 tokenId) external view returns (uint256);

    /// @notice TWAB over an explicit window — used by the draw and the /verify page.
    /// @param tokenId the Chog position
    /// @param from    window start (unix seconds)
    /// @param to      window end (unix seconds), must be >= from and <= now
    function twabOfWindow(uint256 tokenId, uint256 from, uint256 to) external view returns (uint256);

    /// @notice Cumulative TWAB checkpoint at a timestamp, for the /verify derivation.
    function cumulativeOf(uint256 tokenId, uint256 timestamp) external view returns (uint256);

    /// @notice A tokenId's win probability out of the current draw's ticket pool,
    ///         in basis points (0..10000). 0 when there are no tickets.
    function oddsBpsOf(uint256 tokenId) external view returns (uint256);

    /// @notice The tokenIds that had non-zero tickets when drawId was frozen.
    /// @dev This is the racer set the draw engine needs to re-derive winners, so a
    ///      draw is independently re-verifiable from the published seed.
    function frozenRacers(uint256 drawId) external view returns (uint256[] memory);

    /// @notice Tickets frozen for a racer in a draw.
    function ticketsOfFrozen(uint256 drawId, uint256 tokenId) external view returns (uint256);

    /// @notice Total frozen tickets in a draw.
    function totalTicketsOfFrozen(uint256 drawId) external view returns (uint256);

    /// @notice Freeze the ticket book for a draw. Callable only by the draw engine.
    function freezeTickets(uint256 drawId, uint256[] calldata tokenIds) external;

    // ---------- pot settlement ----------

    /// @notice Pay `amount` from the pot to `winner`. Callable only by the draw engine.
    function payPot(address winner, uint256 amount) external;

    /// @notice Move realized yield from the adapter into the pot. Permissionless —
    ///         anyone can trigger a harvest; the money only comes from real trades.
    /// @return amount the asset units moved into the pot
    function harvest() external returns (uint256 amount);
}
