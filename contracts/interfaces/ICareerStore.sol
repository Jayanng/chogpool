// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ICareerStore, frozen contract between contracts/ and web/ (2026-10-14).
/// @notice FROZEN INTERFACE. Changing anything here requires BOTH owners to approve.
///
/// The portable career record: trophies, fatigue and race
/// history per Chog, readable by the frontend so a Chog's record travels with it.
interface ICareerStore {
    // ---------- events ----------

    event RaceRecorded(uint256 indexed tokenId, uint256 indexed raceId, uint8 placement, int256 fatigueDelta);
    event TrophyAwarded(uint256 indexed tokenId, uint8 place); // 1 gold, 2 silver, 3 bronze
    event FatigueDecayed(uint256 indexed tokenId, uint256 from, uint256 to);

    // ---------- errors ----------

    error NotDrawEngine();
    error InvalidPlacement(uint8 placement);
    error RaceAlreadyRecorded(uint256 tokenId, uint256 raceId);

    // ---------- configuration ----------

    function drawEngine() external view returns (address);

    // ---------- recording (draw engine only) ----------

    /// @notice Record a completed race for a Chog. Placement 1-3 awards a trophy.
    function recordRace(uint256 tokenId, uint256 raceId, uint8 placement, int256 fatigueDelta) external;

    // ---------- views ----------

    struct Career {
        uint32 gold;
        uint32 silver;
        uint32 bronze;
        uint32 races;
        uint32 wins;
        uint32 lastRaceAt;
        uint256 fatigue; // 1e18 fixed point; 0 = fresh, higher = burdened
    }

    function getCareer(uint256 tokenId) external view returns (Career memory);

    function trophiesOf(uint256 tokenId) external view returns (uint32 gold, uint32 silver, uint32 bronze);

    function fatigueOf(uint256 tokenId) external view returns (uint256);

    /// @notice Fatigue decays by `decayPerDay` per day elapsed; returns the current value.
    function currentFatigueOf(uint256 tokenId) external view returns (uint256);

    /// @notice Fatigue multiplier on win probability, in 1e18 fixed point (1e18 = neutral).
    /// @dev Decays linearly toward neutral as fatigue decays. Capped window enforced by caller.
    function fatigueMultiplierOf(uint256 tokenId) external view returns (uint256);

    function raceCountOf(uint256 tokenId) external view returns (uint32);

    /// @notice The raceIds recorded for a tokenId (for the profile page history).
    function racesOf(uint256 tokenId) external view returns (uint256[] memory);
}
