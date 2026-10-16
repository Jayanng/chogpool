// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ICareerStore} from "../interfaces/ICareerStore.sol";

/// @title CareerStore, the portable career record for every Chog.
/// @notice Production implementation of the FROZEN ICareerStore interface.
///
/// The record is the "portable career" pitch: trophies,
/// fatigue and race history per Chog, readable by the frontend so a Chog's history
/// travels with it. Only the draw engine may write, so results cannot be forged by
/// anyone else.
///
/// Fatigue is the Champion's Burden: winning adds fatigue, and fatigue decays by
/// `decayPerDay` per day elapsed. `fatigueMultiplierOf` returns the resulting
/// win-probability multiplier (1e18 = neutral), which the draw engine applies inside
/// the capped boost window.
contract CareerStore is ICareerStore, Ownable2Step {
    // ---------------- state ----------------

    /// @inheritdoc ICareerStore
    address public drawEngine;

    /// @dev Fatigue removed per day elapsed (1e18 fixed point).
    uint256 public decayPerDay = 0.1e18;

    /// @dev Fatigue at which the multiplier bottoms out (1e18 fixed point).
    uint256 public maxFatigue = 1e18;

    /// @dev The worst multiplier a fatigued Chog can suffer (1e18 fixed point).
    uint256 public minMultiplier = 0.5e18;

    struct Record {
        uint32 gold;
        uint32 silver;
        uint32 bronze;
        uint32 races;
        uint32 wins;
        uint32 lastRaceAt;
        uint256 fatigue; // 1e18 fixed point; 0 = fresh, higher = burdened
        uint256[] raceIds;
        /// @dev raceId => placement, so the UI can render the history table.
        mapping(uint256 => uint8) placements;
    }

    mapping(uint256 => Record) private _records;

    /// @dev Declared locally rather than in the frozen ICareerStore, because adding
    ///      an error to a frozen interface needs both owners' approval.
    error ZeroAddress();
    error BadParams();

    // ---------------- construction ----------------

    constructor(address owner_) Ownable(owner_) {}

    // ---------------- wiring ----------------

    function setDrawEngine(address engine) external onlyOwner {
        if (engine == address(0)) revert ZeroAddress();
        drawEngine = engine;
    }

    function setFatigueParams(uint256 decayPerDay_, uint256 maxFatigue_, uint256 minMultiplier_)
        external
        onlyOwner
    {
        if (decayPerDay_ == 0 || maxFatigue_ == 0) revert BadParams();
        if (minMultiplier_ == 0 || minMultiplier_ > 1e18) revert BadParams();
        decayPerDay = decayPerDay_;
        maxFatigue = maxFatigue_;
        minMultiplier = minMultiplier_;
    }

    // ---------------- recording (draw engine only) ----------------

    /// @inheritdoc ICareerStore
    function recordRace(uint256 tokenId, uint256 raceId, uint8 placement, int256 fatigueDelta)
        external
        onlyDrawEngine
    {
        // Placement is 1..N; anything else is a caller bug we refuse to record.
        if (placement == 0) revert InvalidPlacement(placement);

        Record storage r = _records[tokenId];
        if (r.placements[raceId] != 0) revert RaceAlreadyRecorded(tokenId, raceId);

        // Settle decayed fatigue to "now" before applying this race's delta, so the
        // stored value is always as-of the last activity.
        r.fatigue = currentFatigueOf(tokenId);

        r.placements[raceId] = placement;
        r.raceIds.push(raceId);
        r.races += 1;
        r.lastRaceAt = uint32(block.timestamp);

        if (placement == 1) {
            r.gold += 1;
            r.wins += 1;
            emit TrophyAwarded(tokenId, 1);
        } else if (placement == 2) {
            r.silver += 1;
            emit TrophyAwarded(tokenId, 2);
        } else if (placement == 3) {
            r.bronze += 1;
            emit TrophyAwarded(tokenId, 3);
        }

        // Apply the delta, clamped to [0, maxFatigue]. A win adds fatigue (the
        // Champion's Burden); a loss is neutral or slightly relieving.
        int256 next = int256(r.fatigue) + fatigueDelta;
        if (next < 0) next = 0;
        if (next > int256(maxFatigue)) next = int256(maxFatigue);
        r.fatigue = uint256(next);

        emit RaceRecorded(tokenId, raceId, placement, fatigueDelta);
    }

    // ---------------- views ----------------

    /// @inheritdoc ICareerStore
    function getCareer(uint256 tokenId) external view returns (Career memory career) {
        Record storage r = _records[tokenId];
        career.gold = r.gold;
        career.silver = r.silver;
        career.bronze = r.bronze;
        career.races = r.races;
        career.wins = r.wins;
        career.lastRaceAt = r.lastRaceAt;
        career.fatigue = currentFatigueOf(tokenId);
    }

    /// @inheritdoc ICareerStore
    function trophiesOf(uint256 tokenId) external view returns (uint32 gold, uint32 silver, uint32 bronze) {
        Record storage r = _records[tokenId];
        return (r.gold, r.silver, r.bronze);
    }

    /// @inheritdoc ICareerStore
    function fatigueOf(uint256 tokenId) external view returns (uint256) {
        return _records[tokenId].fatigue;
    }

    /// @inheritdoc ICareerStore
    function currentFatigueOf(uint256 tokenId) public view returns (uint256) {
        Record storage r = _records[tokenId];
        uint256 stored = r.fatigue;
        if (stored == 0) return 0;

        uint256 last = r.lastRaceAt;
        if (last == 0 || block.timestamp <= last) return stored;

        uint256 elapsed = block.timestamp - last;
        uint256 decayed = (elapsed * decayPerDay) / 1 days;
        if (decayed >= stored) return 0;
        return stored - decayed;
    }

    /// @inheritdoc ICareerStore
    /// @dev Linear: fatigue 0 => 1e18 (neutral), fatigue at maxFatigue => minMultiplier.
    ///      Monotonically decreasing in fatigue, so the decay above translates
    ///      directly into recovering win probability over time.
    function fatigueMultiplierOf(uint256 tokenId) external view returns (uint256) {
        uint256 fatigue = currentFatigueOf(tokenId);
        if (fatigue == 0) return 1e18;
        if (fatigue >= maxFatigue) return minMultiplier;

        // multiplier = 1e18 - (fatigue/maxFatigue) * (1e18 - minMultiplier)
        uint256 span = 1e18 - minMultiplier;
        return 1e18 - (fatigue * span) / maxFatigue;
    }

    /// @inheritdoc ICareerStore
    function raceCountOf(uint256 tokenId) external view returns (uint32) {
        return _records[tokenId].races;
    }

    /// @inheritdoc ICareerStore
    function racesOf(uint256 tokenId) external view returns (uint256[] memory) {
        return _records[tokenId].raceIds;
    }

    /// @notice The placement recorded for a race, for the profile history table.
    function placementOf(uint256 tokenId, uint256 raceId) external view returns (uint8) {
        return _records[tokenId].placements[raceId];
    }

    // ---------------- internals ----------------

    modifier onlyDrawEngine() {
        if (msg.sender != drawEngine) revert NotDrawEngine();
        _;
    }
}
