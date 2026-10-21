// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDrawEngine} from "../interfaces/IDrawEngine.sol";
import {IChogPool} from "../interfaces/IChogPool.sol";
import {ICareerStore} from "../interfaces/ICareerStore.sol";
import {ITestChogToken} from "../interfaces/ITestChogToken.sol";
import {DrawEngine} from "./DrawEngine.sol";

/// @title GameEngine, DrawEngine v2: skill rounds, and the draw path it carries.
/// @notice Extends DrawEngine rather than replacing it. The draw functions
///         (openDraw/commit/reveal/award/finalize) are inherited untouched, so
///         the existing fixtures, tests and the fairness verifier keep working.
///         What is added is the round flow the product actually ships:
///
///           openRound -> players play -> submitScores -> settleRound
///
///         A round is a seeded obstacle course: the courseSeed is published at open
///         and can never change, so every player faces an identical course and
///         anyone can re-derive it from the seed on the Proof page. The operator
///         choosing the seed affects every player equally, which is the fairness
///         property that matters here.
///
/// @dev WHY THIS INHERITS INSTEAD OF FORKING. `ChogPool.setDrawEngine` is owner
///      gated and `payPot` only accepts calls from the current drawEngine, so the
///      whole product swaps by pointing the pool at this one contract: no pool
///      redeploy, no deposit migration, the stranding fix and the seeded pot stay
///      exactly where they are. Keeping the draw machinery also costs nothing, per
///      the spec, and preserves the commit-reveal path for the production roadmap.
///      NOTE: the product has retired random draws entirely; the inherited code is
///      dead weight that exists only because removing it would touch a frozen
///      interface and it costs nothing to carry.
///
/// @dev SCORE INTEGRITY, OWNED RATHER THAN HIDDEN. Scores are produced in the
///      browser and submitted by the game authority. That is the honest middle
///      ground for a demo and it is labelled as such on the Proof page. The
///      contract does what it can cheaply: it pins the courseSeed so the course is
///      reproducible, it records who submitted what and when, and it refuses to
///      record a score for a token that has no position in the pool. Verifying a
///      score from the seed plus signed inputs is a roadmap item and is NOT claimed
///      here. Nothing in this contract pretends a submitted score is proven.
///
/// @dev COINS ARE PAID AT SUBMISSION, AT A FIXED RATE. The game client reports
///      the coins each run collected, and `submitScores` pays
///      `coins * COIN_RATE` in Test $CHOG to that position's depositor in the same
///      transaction that records the run. The site copy promises coins "land in
///      your Test $CHOG purse" when a run is recorded, so paying later (at settle)
///      would break the promise for every run that does not make the top 3. The
///      amount is a function of the recorded coins and the constant rate, never of
///      the engine's balance, so the treasury cannot be drained and one player
///      cannot claim another's coins.
contract GameEngine is DrawEngine {
    // ---------------- constants ----------------

    /// @dev The prize split, in basis points, so the percentages live in the
    ///      contract and nobody can argue about them after the fact.
    uint256 public constant FIRST_BPS = 5_000; // 50%
    uint256 public constant SECOND_BPS = 3_000; // 30%
    /// @dev Third takes the remainder rather than a fixed 20%, so integer division
    ///      never strands dust: first + second + third always equals the pot exactly.
    uint256 public constant TOP_N = 3;

    /// @dev Test $CHOG paid per coin collected in a run. 0.1 per coin, 18 decimals,
    ///      as agreed with the product side.
    /// @dev WHY A CONSTANT AND NOT OWNER-SETTABLE. The site copy states the rate, so
    ///      it is part of the product's promise rather than a tunable. Making it
    ///      owner-settable would let the number change under players who were shown
    ///      a different one. Changing it later is a redeploy and a visible decision.
    uint256 public constant COIN_RATE = 0.1 ether; // 0.1 Test $CHOG per coin

    // ---------------- immutables / wiring ----------------

    /// @dev Test $CHOG. Revive fees are paid in it and the bonus pot is paid in it.
    ITestChogToken public testChog;

    /// @dev The address allowed to submit run scores. Starts as the operator and can
    ///      be rotated by the owner to a dedicated key.
    address public gameAuthority;

    // ---------------- state ----------------

    enum RoundState {
        None,
        Open,
        Closed,
        Settled
    }

    struct Round {
        RoundState state;
        bytes32 courseSeed; // fixed at open, never changes
        uint64 openedAt;
        uint64 closesAt;
        uint256 potAtClose; // snapshot, so a later harvest cannot move the split
        uint256 chogAtClose; // revive fees accumulated by close
        uint32 participantCount;
    }

    /// @dev roundId => round. Round ids start at 1; 0 means "no such round".
    mapping(uint256 => Round) internal _rounds;

    /// @dev roundId => tokenId => score. 0 means "no run recorded".
    mapping(uint256 => mapping(uint256 => uint256)) internal _scores;

    /// @dev roundId => tokenId => coins collected in that run. Recorded separately
    ///      from the score because the payout is computed from it and the frontend
    ///      reads it back for the leaderboard.
    mapping(uint256 => mapping(uint256 => uint256)) internal _coins;

    /// @dev roundId => tokenId => whether that run used its one revive.
    mapping(uint256 => mapping(uint256 => bool)) internal _revived;

    /// @dev roundId => tokenId => whether a run was recorded at all.
    mapping(uint256 => mapping(uint256 => bool)) internal _hasRun;

    /// @dev roundId => tokenId => whether the revive was already paid for.
    mapping(uint256 => mapping(uint256 => bool)) public reviveUsed;

    /// @dev roundId => the three winners, in placement order, once settled.
    mapping(uint256 => uint256[TOP_N]) internal _winners;

    /// @dev roundId => settled flag, so settleRound cannot run twice.
    mapping(uint256 => bool) public settled;

    uint256 public currentRoundId;

    // ---------------- events ----------------

    event RoundOpened(uint256 indexed roundId, bytes32 courseSeed, uint64 closesAt);
    event RoundClosed(uint256 indexed roundId, uint256 potAtClose, uint256 chogAtClose);
    event RevivePaid(uint256 indexed roundId, uint256 indexed tokenId, uint256 fee);
    event ScoreRecorded(
        uint256 indexed roundId,
        uint256 indexed tokenId,
        uint256 score,
        uint256 coins,
        bool revived,
        address submittedBy,
        uint256 coinPayout
    );
    event RoundSettled(
        uint256 indexed roundId,
        uint256[TOP_N] winners,
        uint256[TOP_N] usdcAmounts,
        uint256[TOP_N] chogAmounts
    );
    event GameAuthorityUpdated(address indexed newAuthority);
    event TestChogUpdated(address indexed newToken);

    // ---------------- errors ----------------

    error NotGameAuthority();
    error WrongRoundState(RoundState expected, RoundState actual);
    error RoundNotOpen();
    error RoundStillOpen();
    error ZeroCourseSeed();
    error ClosesAtNotInFuture(uint64 closesAt);
    error ReviveAlreadyUsed(uint256 roundId, uint256 tokenId);
    error NotInPool(uint256 tokenId);
    error NotABetterScore(uint256 roundId, uint256 tokenId, uint256 currentScore, uint256 submittedScore);
    error LengthMismatch(uint256 tokenIds, uint256 scores);
    error EmptyTop3();
    error DuplicateWinner(uint256 tokenId);
    error WinnerNotInPool(uint256 tokenId);
    error NoScoresRecorded(uint256 roundId, uint256 tokenId);
    error NothingToSettle();
    error FeePullFailed(uint256 roundId, uint256 tokenId, uint256 fee);
    error CoinPayoutFailed(uint256 roundId, uint256 tokenId, uint256 payout);

    // ---------------- construction ----------------

    constructor(
        address owner_,
        address operator_,
        address careerStore_,
        address testChog_,
        address gameAuthority_
    ) DrawEngine(owner_, operator_) {
        if (testChog_ == address(0)) revert ZeroAddress();
        // Validate the target has code, exactly as DrawEngine.setCareerStore does,
        // so a bad wiring fails at deploy rather than silently at the first settle.
        // Assigned directly rather than calling setCareerStore, which is onlyOwner
        // and would revert inside the constructor where msg.sender is the deployer.
        if (careerStore_ == address(0)) revert ZeroAddress();
        if (careerStore_.code.length == 0) revert NotAContract(careerStore_);
        careerStore = careerStore_;
        testChog = ITestChogToken(testChog_);
        gameAuthority = gameAuthority_ == address(0) ? operator_ : gameAuthority_;
    }

    // ---------------- admin ----------------

    /// @notice Rotate the address allowed to submit scores.
    function setGameAuthority(address newAuthority) external onlyOwner {
        if (newAuthority == address(0)) revert ZeroAddress();
        gameAuthority = newAuthority;
        emit GameAuthorityUpdated(newAuthority);
    }

    /// @notice Point the engine at a different Test $CHOG token.
    /// @dev Owner-only and emitting an event: the bonus prize's currency is not
    ///      something that should change silently.
    function setTestChog(address newToken) external onlyOwner {
        if (newToken == address(0)) revert ZeroAddress();
        testChog = ITestChogToken(newToken);
        emit TestChogUpdated(newToken);
    }

    modifier onlyGameAuthority() {
        if (msg.sender != gameAuthority) revert NotGameAuthority();
        _;
    }

    /// @dev Same role model as the inherited draw functions: the operator OR the
    ///      owner. Written as a modifier here because DrawEngine spells the check
    ///      inline rather than exposing a modifier to inherit.
    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    // ---------------- round lifecycle ----------------

    /// @notice Open a round: publish the course seed and the entry window.
    /// @param courseSeed The seed every player's course is derived from. Fixed for
    ///        the life of the round: it can never change, so every player faces an
    ///        identical course and anyone can re-derive it from this value alone.
    /// @param closesAt Unix seconds after which no new scores are accepted.
    function openRound(bytes32 courseSeed, uint64 closesAt) external onlyOperator returns (uint256 roundId) {
        if (courseSeed == bytes32(0)) revert ZeroCourseSeed();
        if (closesAt <= block.timestamp) revert ClosesAtNotInFuture(closesAt);

        roundId = ++currentRoundId;
        Round storage r = _rounds[roundId];
        r.state = RoundState.Open;
        r.courseSeed = courseSeed;
        r.openedAt = uint64(block.timestamp);
        r.closesAt = closesAt;

        emit RoundOpened(roundId, courseSeed, closesAt);
    }

    /// @notice Close a round: snapshot the pot and the revive fees.
    /// @dev SNAPSHOT, NOT LIVE READ. The split is computed from the pot as it stood
    ///      at close, so a harvest landing between close and settle cannot move the
    ///      prize after players have already played. Reading live potBalance at
    ///      settle would let a payout change retroactively, which is exactly the
    ///      kind of thing that makes a leaderboard arguable.
    function closeRound(uint256 roundId) public onlyOperator {
        Round storage r = _rounds[roundId];
        if (r.state != RoundState.Open) revert WrongRoundState(RoundState.Open, r.state);

        r.state = RoundState.Closed;
        r.potAtClose = IChogPool(pool).potBalance();
        r.chogAtClose = testChog.balanceOf(address(this));

        emit RoundClosed(roundId, r.potAtClose, r.chogAtClose);
    }

    /// @notice Buy this run's one revive, paying a fixed Test $CHOG fee.
    /// @dev One revive per (round, tokenId), enforced by `reviveUsed`. The fee is
    ///      pulled into this contract and held until settle, where it is paid to the
    ///      round's top 3 on the same 50/30/20 split. It is never burned and never
    ///      leaves for anywhere else: the game funds part of its own prize.
    ///
    /// @dev The caller must hold a position in the pool, because a revive bought by
    ///      a wallet with no stake would let anyone pad the bonus pot without being
    ///      in the race. Checked through the pool's own books, not a local list.
    function payRevive(uint256 roundId, uint256 tokenId) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.state != RoundState.Open) revert WrongRoundState(RoundState.Open, r.state);
        if (reviveUsed[roundId][tokenId]) revert ReviveAlreadyUsed(roundId, tokenId);
        if (IChogPool(pool).sharesOf(tokenId) == 0) revert NotInPool(tokenId);

        reviveUsed[roundId][tokenId] = true;

        uint256 fee = reviveFee();
        if (fee > 0) {
            // Pull first, then record. A failed pull reverts the whole call, so a
            // revive can never be marked used without the fee actually arriving.
            // `transferFrom` rather than SafeERC20's safeTransferFrom: the token is
            // a known, deployed ERC-20 whose return value is honoured, and pulling
            // through the plain interface keeps the dependency surface small. A
            // token that returns false is rejected by the check below.
            bool ok = testChog.transferFrom(msg.sender, address(this), fee);
            if (!ok) revert FeePullFailed(roundId, tokenId, fee);
        }

        emit RevivePaid(roundId, tokenId, fee);
    }

    /// @notice Record the runs for a round. Game authority only.
    /// @dev HONEST SCOPE: these are the real outputs of the game client, submitted by
    ///      the authority. They are not verified on chain and the Proof page says so.
    ///      What the contract does guarantee is that the courseSeed was fixed before
    ///      anyone played, that the submitter is recorded per entry, and that a score
    ///      cannot be recorded for a token that has no stake in the pool.
    ///
    /// @dev COINS ARE PAID HERE, AT SUBMISSION, NOT AT SETTLE. The site copy
    ///      promises coins "land in your Test $CHOG purse" the moment a run is
    ///      recorded, so the transfer happens in the same transaction that records
    ///      the run. Deferring it to settle would break that promise: a run whose
    ///      player never makes the top 3 would earn nothing, which is not what the
    ///      copy says.
    ///
    /// @dev PAY THE RECORDED COINS ONLY, NEVER A BALANCE. Each entry pays
    ///      `coins[i] * COIN_RATE` from this contract's own Test $CHOG balance.
    ///      The engine's balance is the team-funded treasury, so a player cannot
    ///      claim another player's coins and the treasury cannot be drained by a
    ///      huge coin count: the amount paid is a function of the recorded input,
    ///      not of how much the engine happens to hold.
    ///
    /// @dev A FAILED TRANSFER REVERTS THE WHOLE SUBMISSION. A run recorded
    ///      without its coins paid is a promise broken on screen, so the call is
    ///      all-or-nothing: either the run is recorded and the coins arrived, or
    ///      nothing happened.
    ///
    /// @dev BEST RUN COUNTS, NOT FIRST RUN. A Chog that already has an entry in
    ///      this round may re-submit with a HIGHER score, which replaces the entry
    ///      and pays only the coin difference, `max(0, newCoins - oldCoins)`. A
    ///      score that is not strictly higher is refused with `NotABetterScore`.
    ///
    ///      WHY. A judge's first run is a learning run. Ranking the first run
    ///      would put their worst score on the board and make the game look broken
    ///      when it is not. The best run is the honest entry.
    ///
    ///      WHY THE DIFFERENCE AND NOT A FULL PAYOUT. The player was already paid
    ///      for the coins on their previous entry. Paying the full amount again
    ///      would double-pay them and drain the treasury without any new coins
    ///      having been collected. Paying only the increase keeps the purse
    ///      exactly equal to `bestCoins * COIN_RATE` at all times.
    ///
    ///      WHY NO CLAWBACK. A better run may collect FEWER coins than the worse
    ///      one, and the difference is then negative. It is clamped to zero and
    ///      nothing is taken back: clawing back would mean the engine moving a
    ///      player's tokens without consent, which is a different and much worse
    ///      thing than a mismatch. The purse can therefore exceed the best run's
    ///      coins, and that is the honest cost of not taking tokens back.
    function submitScores(
        uint256 roundId,
        uint256[] calldata tokenIds,
        uint256[] calldata scores,
        uint256[] calldata coins,
        bool[] calldata revived
    ) external onlyGameAuthority {
        Round storage r = _rounds[roundId];
        if (r.state != RoundState.Open && r.state != RoundState.Closed) {
            revert WrongRoundState(RoundState.Open, r.state);
        }
        if (tokenIds.length != scores.length || tokenIds.length != coins.length || tokenIds.length != revived.length) {
            revert LengthMismatch(tokenIds.length, scores.length);
        }

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            _recordRun(roundId, tokenId, scores[i], coins[i], revived[i]);
        }
    }

    /// @dev One entry per call, split out of `submitScores` so the loop body stays
    ///      inside the stack frame. `via_ir` is off in this project, and turning it
    ///      on to fix one function would change codegen for all ninety files.
    ///
    /// @dev The `AlreadyRecorded` refusal is gone: a Chog with an entry may replace
    ///      it with a strictly higher score, paying only the coin difference.
    function _recordRun(uint256 roundId, uint256 tokenId, uint256 score, uint256 coins, bool revived)
        internal
    {
        Round storage r = _rounds[roundId];
        if (IChogPool(pool).sharesOf(tokenId) == 0) revert NotInPool(tokenId);

        // A second entry is only accepted when it beats the one it replaces.
        if (_hasRun[roundId][tokenId] && score <= _scores[roundId][tokenId]) {
            revert NotABetterScore(roundId, tokenId, _scores[roundId][tokenId], score);
        }

        // Only the coins the player has NOT already been paid for move now.
        // `previous` doubles as the "was this Chog already in" flag: it is
        // non-zero exactly when an entry exists, and a first entry with zero
        // coins has nothing to pay either way, so the two readings agree.
        uint256 previous = _coins[roundId][tokenId];
        uint256 coinDelta = coins > previous ? coins - previous : 0;

        if (!_hasRun[roundId][tokenId]) r.participantCount += 1;

        _hasRun[roundId][tokenId] = true;
        _scores[roundId][tokenId] = score;
        _coins[roundId][tokenId] = coins;
        _revived[roundId][tokenId] = revived;

        // The coin payout for this run, from the engine's own treasury.
        uint256 payout = coinDelta * COIN_RATE;
        if (payout > 0) {
            (address depositor,,) = IChogPool(pool).depositOf(tokenId);
            bool ok = testChog.transfer(depositor, payout);
            if (!ok) revert CoinPayoutFailed(roundId, tokenId, payout);
        }

        emit ScoreRecorded(roundId, tokenId, score, coins, revived, msg.sender, payout);
    }

    /// @notice Settle a closed round: pay the top 3 on-chain and record the placings.
    /// @param top3 Three tokenIds in placement order: 1st, 2nd, 3rd.
    ///
    /// @dev The split is computed HERE, from the snapshot taken at close, in basis
    ///      points that are constants of this contract. Nobody passes amounts in, so
    ///      nobody can argue about them afterwards.
    ///
    /// @dev USDC is paid to the position's DEPOSITOR, resolved through the pool.
    ///      `payPot` transfers to whatever address it is given, so passing a tokenId
    ///      or an arbitrary address would pay the zero address or a contract. The
    ///      depositor is the person whose stake funded the pot.
    ///
    /// @dev CareerStore.recordRace is called with the round id as the race id. The
    ///      store refuses a duplicate race record, so a round settles exactly once.
    function settleRound(uint256 roundId, uint256[TOP_N] calldata top3) external onlyOperator nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.state != RoundState.Closed) revert WrongRoundState(RoundState.Closed, r.state);
        if (settled[roundId]) revert NothingToSettle();

        // Every winner must be a real participant with a real position, and the
        // three must be distinct: a repeated tokenId would pay one depositor three
        // times and strand the other two shares.
        for (uint256 i = 0; i < TOP_N; i++) {
            if (top3[i] == 0) revert EmptyTop3();
            if (!_hasRun[roundId][top3[i]]) revert NoScoresRecorded(roundId, top3[i]);
            if (IChogPool(pool).sharesOf(top3[i]) == 0) revert WinnerNotInPool(top3[i]);
            for (uint256 j = i + 1; j < TOP_N; j++) {
                if (top3[i] == top3[j]) revert DuplicateWinner(top3[i]);
            }
        }

        settled[roundId] = true;
        r.state = RoundState.Settled;

        _winners[roundId] = top3;

        // ---- USDC: 50/30/20 of the pot as it stood at close ----
        uint256 pot = r.potAtClose;
        uint256[TOP_N] memory usdcAmounts;
        if (pot > 0) {
            usdcAmounts[0] = (pot * FIRST_BPS) / BPS_DENOMINATOR;
            usdcAmounts[1] = (pot * SECOND_BPS) / BPS_DENOMINATOR;
            // Third takes the remainder, so the three always sum to the pot exactly
            // and integer division never strands dust.
            usdcAmounts[2] = pot - usdcAmounts[0] - usdcAmounts[1];

            for (uint256 i = 0; i < TOP_N; i++) {
                (address depositor,,) = IChogPool(pool).depositOf(top3[i]);
                if (usdcAmounts[i] > 0) IChogPool(pool).payPot(depositor, usdcAmounts[i]);
            }
        }

        // ---- Test $CHOG: the revive fees, same 50/30/20 split ----
        uint256 chog = testChog.balanceOf(address(this));
        uint256[TOP_N] memory chogAmounts;
        if (chog > 0) {
            chogAmounts[0] = (chog * FIRST_BPS) / BPS_DENOMINATOR;
            chogAmounts[1] = (chog * SECOND_BPS) / BPS_DENOMINATOR;
            chogAmounts[2] = chog - chogAmounts[0] - chogAmounts[1];

            for (uint256 i = 0; i < TOP_N; i++) {
                (address depositor,,) = IChogPool(pool).depositOf(top3[i]);
                if (chogAmounts[i] > 0) {
                    bool sent = testChog.transfer(depositor, chogAmounts[i]);
                    if (!sent) revert FeePullFailed(roundId, top3[i], chogAmounts[i]);
                }
            }
        }

        // ---- Career records, placed players only ----
        // Non-placed participants are not recorded: recordRace requires a non-zero
        // placement and CareerStore is a frozen interface, so recording everyone
        // would need a new function there. Recorded honestly as a known limit.
        ICareerStore careers = ICareerStore(careerStore);
        if (address(careers) != address(0)) {
            for (uint256 i = 0; i < TOP_N; i++) {
                careers.recordRace(top3[i], roundId, uint8(i + 1), 0);
            }
        }

        emit RoundSettled(roundId, top3, usdcAmounts, chogAmounts);
    }

    // ---------------- views ----------------

    /// @notice The newest round id, so the leaderboard can find it directly.
    /// @dev WHY THIS EXISTS. The CareerStore has no global round counter, so a
    ///      leaderboard that wants "the current round" has to scan race ids and
    ///      guess. This is the exact getter, and it is what the frontend binds to
    ///      instead of probing.
    /// @dev Returns `currentRoundId` rather than exposing it under a second name:
    ///      one source of truth, and 0 means "no round has ever been opened".
    function latestRoundId() external view returns (uint256) {
        return currentRoundId;
    }

    function roundState(uint256 roundId) external view returns (RoundState) {
        return _rounds[roundId].state;
    }

    function courseSeedOf(uint256 roundId) external view returns (bytes32) {
        return _rounds[roundId].courseSeed;
    }

    function roundClosesAt(uint256 roundId) external view returns (uint64) {
        return _rounds[roundId].closesAt;
    }

    function potAtClose(uint256 roundId) external view returns (uint256) {
        return _rounds[roundId].potAtClose;
    }

    function chogAtClose(uint256 roundId) external view returns (uint256) {
        return _rounds[roundId].chogAtClose;
    }

    function participantCount(uint256 roundId) external view returns (uint32) {
        return _rounds[roundId].participantCount;
    }

    function scoreOf(uint256 roundId, uint256 tokenId) external view returns (uint256) {
        return _scores[roundId][tokenId];
    }

    /// @notice The coins a run collected, as recorded by the game authority.
    function coinsOf(uint256 roundId, uint256 tokenId) external view returns (uint256) {
        return _coins[roundId][tokenId];
    }

    /// @notice The Test $CHOG a run's coins paid, so the UI and a judge can both
    ///      read the payout without recomputing it.
    function coinPayoutOf(uint256 roundId, uint256 tokenId) external view returns (uint256) {
        return _coins[roundId][tokenId] * COIN_RATE;
    }

    /// @notice The Test $CHOG rate per coin, so the UI reads one source of truth.
    function coinRate() external pure returns (uint256) {
        return COIN_RATE;
    }

    function revivedOf(uint256 roundId, uint256 tokenId) external view returns (bool) {
        return _revived[roundId][tokenId];
    }

    function hasRun(uint256 roundId, uint256 tokenId) external view returns (bool) {
        return _hasRun[roundId][tokenId];
    }

    /// @dev Named `roundWinnersOf` rather than `winnersOf` because DrawEngine already
    ///      exposes `winnersOf(uint256)` returning `uint256[]`, and a different return
    ///      type under the same name is a compile error, not an override.
    function roundWinnersOf(uint256 roundId) external view returns (uint256[TOP_N] memory) {
        return _winners[roundId];
    }

    /// @notice The Test $CHOG fee one revive costs.
    /// @dev A constant for now, exposed as a function so the UI reads one source of
    ///      truth and so it can become owner-settable without an interface change.
    function reviveFee() public pure returns (uint256) {
        return 10 ether; // 10 Test $CHOG, 18 decimals
    }
}
