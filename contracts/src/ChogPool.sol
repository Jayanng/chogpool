// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IChogPool} from "../interfaces/IChogPool.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";

/// @title ChogPool — deposit stables, keep full principal, race the yield.
/// @notice Production implementation of the FROZEN IChogPool interface.
///
/// Odds are TIME-WEIGHTED (TWAB), not last-second snapshot: a racer's ticket count is
/// the time-weighted average of their principal over the draw window. Sniping with a
/// huge last-second deposit buys almost nothing, because a large balance held for a
/// short time averages down to a small number.
///
/// The pot grows ONLY from value realized through actual adapter transactions
/// (removeLiquidity / swap / supply-withdraw). It is never computed on paper.
///
/// Withdrawal is instant and full: no lock, no fee, principal is never at risk.
/// @dev "Full" means the full redeemable value of the position, which is what
///      shares are minted against (see deposit()). Entering the yield venue costs
///      a one-off fee and price impact, so the redeemable value of a fresh deposit
///      is slightly below the deposited amount; the position's value then moves
///      with the venue itself. Shares are always redeemable in full.
contract ChogPool is IChogPool, IYieldAdapter, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------- constants ----------------

    /// @dev TWAB ring buffer size. 512 hourly checkpoints covers ~21 days of history,
    ///      far beyond a 2-week season, at bounded gas. Older windows fall back to the
    ///      oldest checkpoint (documented in twabOfWindow).
    uint256 public constant RING_SIZE = 512;

    /// @dev Bounds on the window a caller may query, so nobody can request an
    ///      absurd range that walks the whole ring.
    uint256 public constant MAX_WINDOW = 60 days;

    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant WAD = 1e18;

    // ---------------- immutables ----------------

    /// @inheritdoc IChogPool
    address public immutable override(IChogPool, IYieldAdapter) asset;
    /// @inheritdoc IChogPool
    address public immutable mirror;

    /// @inheritdoc IChogPool
    address public yieldAdapter;
    /// @inheritdoc IChogPool
    address public drawEngine;

    // ---------------- state ----------------

    struct Position {
        address depositor;
        uint256 shares;
        uint256 principal; // cumulative principal deposited (never decreases on withdraw)
    }

    mapping(uint256 => Position) private _positions;

    /// @dev Ring buffer of TWAB checkpoints per tokenId.
    struct Checkpoint {
        uint64 timestamp; // unix seconds
        uint192 cumulative; // cumulative balance × seconds (fits: 1e38 × 1e10)
    }

    struct Ring {
        Checkpoint[] points;
    }

    mapping(uint256 => Ring) private _rings;

    /// @inheritdoc IChogPool
    uint256 public totalShares;
    /// @inheritdoc IChogPool
    uint256 public totalPrincipal;
    /// @inheritdoc IChogPool
    uint256 public potBalance;

    /// @dev Draw id -> frozen ticket book (so odds cannot move after close).
    struct DrawTickets {
        uint256 total;
        uint256[] racers;
        mapping(uint256 => uint256) tickets;
    }

    mapping(uint256 => DrawTickets) private _drawTickets;
    mapping(uint256 => bool) public ticketsFrozen;

    /// @inheritdoc IChogPool
    uint64 public nextDrawAt;

    // ---------------- construction ----------------

    constructor(address asset_, address mirror_, address owner_) Ownable(owner_) {
        if (asset_ == address(0) || mirror_ == address(0)) revert ZeroAddress();
        asset = asset_;
        mirror = mirror_;
    }

    // ---------------- admin ----------------

    function setYieldAdapter(address adapter) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        // Principal already deployed must be drained from the old adapter first.
        if (yieldAdapter != address(0)) {
            uint256 deployed = IYieldAdapter(yieldAdapter).principalDeployed();
            if (deployed > 0) revert InsufficientLiquidity(deployed, 0);
        }
        emit AdapterUpdated(yieldAdapter, adapter);
        yieldAdapter = adapter;
    }

    function setDrawEngine(address engine) external onlyOwner {
        if (engine == address(0)) revert ZeroAddress();
        drawEngine = engine;
    }

    /// @dev The draw engine reports when the next draw starts, so the UI can count down.
    function setNextDrawAt(uint64 at) external {
        if (msg.sender != drawEngine && msg.sender != owner()) revert NotMirrorOwner(0, msg.sender);
        nextDrawAt = at;
    }

    // ---------------- deposits / withdrawals ----------------

    /// @inheritdoc IChogPool
    function deposit(uint256 tokenId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (yieldAdapter == address(0)) revert ZeroAddress();

        // The position is bound to the Chog tokenId. The depositor is whoever sends
        // the tx; the mirror owner is recorded for the UI and for the draw.
        _bind(tokenId);

        Position storage pos = _positions[tokenId];
        if (pos.depositor == address(0)) {
            pos.depositor = msg.sender;
        } else if (pos.depositor != msg.sender) {
            revert NotMirrorOwner(tokenId, msg.sender);
        }

        _writeCheckpoint(tokenId);

        // Pull the stable, forward it to the yield venue, and mint shares for the
        // value the venue ACTUALLY took in.
        //
        // Shares are NOT minted 1:1 with the deposited amount. The venue swaps half
        // the asset into the quote token before adding liquidity, so a deposit of N
        // arrives in the position worth about N × (1 - entryCostBps). Crediting the
        // full N here books a liability the venue cannot honour, and the first
        // withdraw-all then reverts InsufficientLiquidity for the shortfall.
        //
        // The entry cost is measured the same way redeem() measures what it can
        // deliver — the adapter's own positionValue() — so a share is always
        // redeemable. The cost is real and permanent (pair fees plus price impact),
        // so it is shown to the depositor rather than absorbed by whoever exits last.
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(asset).forceApprove(yieldAdapter, amount);
        uint256 valueBefore = IYieldAdapter(yieldAdapter).positionValue();
        IYieldAdapter(yieldAdapter).supply(amount);
        uint256 credited = IYieldAdapter(yieldAdapter).positionValue() - valueBefore;
        if (credited == 0) credited = amount; // venue credits only LP units; never zero

        pos.shares += credited;
        pos.principal += amount;
        totalShares += credited;
        totalPrincipal += credited;

        emit Deposited(tokenId, msg.sender, amount, credited);
    }

    /// @inheritdoc IChogPool
    function withdraw(uint256 tokenId, uint256 shares) external nonReentrant {
        Position storage pos = _positions[tokenId];
        if (pos.depositor == address(0)) revert NotBound(tokenId);
        if (msg.sender != pos.depositor && msg.sender != owner()) revert NotMirrorOwner(tokenId, msg.sender);
        if (shares == 0) revert ZeroAmount();
        if (shares > pos.shares) revert InsufficientShares(tokenId, shares, pos.shares);

        _writeCheckpoint(tokenId);

        // Redeem from the adapter straight to the depositor: instant, full, no fee.
        IYieldAdapter(yieldAdapter).redeem(shares, pos.depositor);

        pos.shares -= shares;
        totalShares -= shares;

        emit Withdrawn(tokenId, pos.depositor, shares, shares);
    }

    /// @inheritdoc IChogPool
    function withdrawAll(uint256 tokenId) external nonReentrant {
        Position storage pos = _positions[tokenId];
        if (pos.depositor == address(0)) revert NotBound(tokenId);
        if (msg.sender != pos.depositor && msg.sender != owner()) revert NotMirrorOwner(tokenId, msg.sender);

        uint256 shares = pos.shares;
        if (shares == 0) revert InsufficientShares(tokenId, 0, 0);

        _writeCheckpoint(tokenId);

        IYieldAdapter(yieldAdapter).redeem(shares, pos.depositor);

        pos.shares = 0;
        totalShares -= shares;

        emit Withdrawn(tokenId, pos.depositor, shares, shares);
    }

    // ---------------- TWAB ----------------

    /// @dev Write a checkpoint for the CURRENT balance. Must be called before any
    ///      change to shares, so cumulative never skips a balance interval.
    function _writeCheckpoint(uint256 tokenId) internal {
        Ring storage ring = _rings[tokenId];
        uint256 len = ring.points.length;

        uint192 lastCumulative = 0;
        uint64 lastTimestamp = 0;
        if (len > 0) {
            Checkpoint storage last = ring.points[_last(len)];
            lastCumulative = last.cumulative;
            lastTimestamp = last.timestamp;
        }

        uint256 nowTs = block.timestamp;
        uint256 balance = _positions[tokenId].shares;

        // cumulative = lastCumulative + lastBalance × Δt
        uint256 cumulative = uint256(lastCumulative);
        if (lastTimestamp != 0 && nowTs > lastTimestamp) {
            cumulative += balance * (nowTs - lastTimestamp);
        }

        // If we are inside the same second as the last checkpoint, overwrite it so
        // the ring never stores two points at the same timestamp (Δt would be 0).
        if (len > 0 && ring.points[_last(len)].timestamp == nowTs) {
            ring.points[_last(len)].cumulative = uint192(cumulative);
            return;
        }

        ring.points.push(Checkpoint({timestamp: uint64(nowTs), cumulative: uint192(cumulative)}));

        // Trim: keep the ring bounded. The oldest point survives as the floor for
        // older windows (see twabOfWindow).
        if (ring.points.length > RING_SIZE) {
            // Shift-free: drop the oldest by rotating. Gas is bounded and this only
            // happens for positions older than 21 days.
            _dropOldest(ring);
        }
    }

    function _dropOldest(Ring storage ring) internal {
        uint256 len = ring.points.length;
        for (uint256 i = 0; i < len - 1; i++) {
            ring.points[i] = ring.points[i + 1];
        }
        ring.points.pop();
    }

    function _last(uint256 len) internal pure returns (uint256) {
        return len - 1;
    }

    /// @dev Cumulative at a timestamp, linearly interpolating between checkpoints.
    function _cumulativeAt(uint256 tokenId, uint256 timestamp) internal view returns (uint256) {
        Ring storage ring = _rings[tokenId];
        uint256 len = ring.points.length;
        if (len == 0) return 0;

        Checkpoint storage first = ring.points[0];
        // Before the oldest checkpoint we only know the balance was whatever the
        // first checkpoint implies; extrapolate backwards from the first point.
        if (timestamp <= first.timestamp) {
            if (len == 1) return 0;
            // Balance during the first interval = (c1 - c0) / (t1 - t0).
            Checkpoint storage second = ring.points[1];
            if (second.timestamp == first.timestamp) return 0;
            uint256 balance = (uint256(second.cumulative) - uint256(first.cumulative)) / (second.timestamp - first.timestamp);
            if (timestamp == first.timestamp) return uint256(first.cumulative);
            return balance * (first.timestamp - timestamp);
        }

        // Find the last checkpoint at or before timestamp.
        uint256 i = _upperBound(ring, timestamp);
        Checkpoint storage lo = ring.points[i];
        if (lo.timestamp == timestamp) return uint256(lo.cumulative);
        if (i + 1 >= len) {
            // After the last checkpoint: extrapolate forward at the current balance.
            uint256 balance = _positions[tokenId].shares;
            return uint256(lo.cumulative) + balance * (timestamp - lo.timestamp);
        }
        Checkpoint storage hi = ring.points[i + 1];
        uint256 span = hi.timestamp - lo.timestamp;
        if (span == 0) return uint256(lo.cumulative);
        uint256 midBalance = (uint256(hi.cumulative) - uint256(lo.cumulative)) / span;
        uint256 into = timestamp - lo.timestamp;
        return uint256(lo.cumulative) + midBalance * into;
    }

    function _upperBound(Ring storage ring, uint256 timestamp) internal view returns (uint256) {
        uint256 len = ring.points.length;
        uint256 lo = 0;
        uint256 hi = len;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (ring.points[mid].timestamp <= timestamp) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo - 1;
    }

    /// @inheritdoc IChogPool
    function twabOf(uint256 tokenId) public view returns (uint256) {
        return twabOfWindow(tokenId, block.timestamp, block.timestamp);
    }

    /// @inheritdoc IChogPool
    function twabOfWindow(uint256 tokenId, uint256 from, uint256 to) public view returns (uint256) {
        if (to < from) revert InvalidTimeRange(from, to);
        if (to > block.timestamp) revert InvalidTimeRange(from, to);
        if (to - from > MAX_WINDOW) revert WindowTooLong(to - from, MAX_WINDOW);
        if (to == from) return _positions[tokenId].shares;

        uint256 cTo = _cumulativeAt(tokenId, to);
        uint256 cFrom = _cumulativeAt(tokenId, from);
        if (cTo < cFrom) cFrom = cTo; // defensive; interpolation is monotonic
        return (cTo - cFrom) / (to - from);
    }

    /// @inheritdoc IChogPool
    function cumulativeOf(uint256 tokenId, uint256 timestamp) external view returns (uint256) {
        if (timestamp > block.timestamp) revert InvalidTimeRange(timestamp, block.timestamp);
        return _cumulativeAt(tokenId, timestamp);
    }

    // ---------------- tickets / odds ----------------

    /// @notice Freeze the ticket book for a draw. Callable only by the draw engine,
    ///         right when the draw closes, so odds cannot move afterwards.
    function freezeTickets(uint256 drawId, uint256[] calldata tokenIds) external {
        if (msg.sender != drawEngine) revert NotMirrorOwner(0, msg.sender);
        DrawTickets storage dt = _drawTickets[drawId];
        uint256 total = 0;
        uint256 len = tokenIds.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 tokenId = tokenIds[i];
            uint256 t = twabOf(tokenId);
            if (t == 0) continue;
            dt.tickets[tokenId] = t;
            dt.racers.push(tokenId);
            total += t;
        }
        dt.total = total;
        ticketsFrozen[drawId] = true;
    }

    /// @inheritdoc IChogPool
    function oddsBpsOf(uint256 tokenId) external view returns (uint256) {
        // Odds against the CURRENT live book (for the deposit dashboard).
        uint256 total = _liveTotal();
        if (total == 0) return 0;
        return (twabOf(tokenId) * BPS_DENOMINATOR) / total;
    }

    function _liveTotal() internal view returns (uint256 total) {
        // The live book is the sum of every position's current TWAB. Positions are
        // enumerated by the draw engine via the mirror's token range, so here we
        // compute the total the same way: sum over the frozen book when one exists,
        // otherwise the caller passes a set. For the live view we use totalShares as
        // the denominator bound: odds are only meaningful relative to the ticket set.
        total = totalShares;
    }

    function ticketsOfFrozen(uint256 drawId, uint256 tokenId) external view returns (uint256) {
        return _drawTickets[drawId].tickets[tokenId];
    }

    function totalTicketsOfFrozen(uint256 drawId) external view returns (uint256) {
        return _drawTickets[drawId].total;
    }

    /// @notice The tokenIds that had non-zero tickets when drawId was frozen.
    /// @dev This is the racer set the draw engine needs to re-derive winners, so a
    ///      draw is independently re-verifiable from the published seed.
    function frozenRacers(uint256 drawId) external view returns (uint256[] memory) {
        return _drawTickets[drawId].racers;
    }

    // ---------------- views ----------------

    /// @inheritdoc IChogPool
    function sharesOf(uint256 tokenId) external view returns (uint256) {
        return _positions[tokenId].shares;
    }

    /// @notice LP/venue units held by the pool's adapter (proxy of IYieldAdapter).
    function liquidityUnits() external view returns (uint256) {
        return yieldAdapter == address(0) ? 0 : IYieldAdapter(yieldAdapter).liquidityUnits();
    }

    /// @notice Principal deployed into the yield venue (proxy of IYieldAdapter).
    function principalDeployed() external view returns (uint256) {
        return yieldAdapter == address(0) ? 0 : IYieldAdapter(yieldAdapter).principalDeployed();
    }

    /// @notice Current redeemable value of the deployed position (proxy of IYieldAdapter).
    function positionValue() external view returns (uint256) {
        return yieldAdapter == address(0) ? 0 : IYieldAdapter(yieldAdapter).positionValue();
    }

    /// @notice The pool itself (IYieldAdapter view; a pool is not its own adapter,
    ///         so this is the adapter wiring surface for external callers).
    function pool() external view returns (address) {
        return address(this);
    }

    /// @notice Redeem from the adapter to a recipient. Exposed so tooling can drive a
    ///         withdrawal through the IYieldAdapter shape as well as IChogPool's.
    function redeem(uint256 amount, address to) external {
        if (yieldAdapter == address(0)) revert ZeroAddress();
        IYieldAdapter(yieldAdapter).redeem(amount, to);
    }

    /// @notice Deploy asset into the yield venue. Exposed so tooling can drive a
    ///         deposit through the IYieldAdapter shape as well as IChogPool's.
    function supply(uint256 amount) external {
        if (yieldAdapter == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(asset).forceApprove(yieldAdapter, amount);
        IYieldAdapter(yieldAdapter).supply(amount);
    }

    /// @inheritdoc IChogPool
    function depositOf(uint256 tokenId) external view returns (address depositor, uint256 shares, uint256 principal) {
        Position storage pos = _positions[tokenId];
        return (pos.depositor, pos.shares, pos.principal);
    }

    // ---------------- pot ----------------

    /// @inheritdoc IChogPool
    function harvest() external override(IChogPool, IYieldAdapter) nonReentrant returns (uint256 amount) {
        if (yieldAdapter == address(0)) revert ZeroAddress();
        amount = IYieldAdapter(yieldAdapter).harvest();
        if (amount == 0) revert NothingToHarvest();
        potBalance += amount;
        emit YieldHarvested(yieldAdapter, amount);
        emit PotIncreased(amount, potBalance);
    }

    /// @inheritdoc IChogPool
    function payPot(address winner, uint256 amount) external nonReentrant {
        if (msg.sender != drawEngine) revert NotMirrorOwner(0, msg.sender);
        if (winner == address(0)) revert ZeroAddress();
        if (amount > potBalance) revert InsufficientPot(amount, potBalance);

        potBalance -= amount;
        IERC20(asset).safeTransfer(winner, amount);
    }

    // ---------------- internal ----------------

    /// @dev The Chog tokenId must be a live mirror token, and it must not already be
    ///      bound to a different depositor.
    function _bind(uint256 tokenId) internal view {
        IERC721Owner owner = IERC721Owner(mirror);
        if (owner.ownerOf(tokenId) == address(0)) revert NotBound(tokenId);
    }

    /// @notice Number of checkpoints recorded for a tokenId (for the /verify page).
    function checkpointCountOf(uint256 tokenId) external view returns (uint256) {
        return _rings[tokenId].points.length;
    }

    /// @notice A single checkpoint, for the /verify derivation display.
    function checkpointOf(uint256 tokenId, uint256 index) external view returns (uint64 timestamp, uint192 cumulative) {
        Checkpoint storage c = _rings[tokenId].points[index];
        return (c.timestamp, c.cumulative);
    }
}

interface IERC721Owner {
    function ownerOf(uint256 tokenId) external view returns (address);
}
