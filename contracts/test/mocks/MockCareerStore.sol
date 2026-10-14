// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ICareerStore} from "../../interfaces/ICareerStore.sol";

/// @title MockCareerStore — DEV/TEST ONLY. Never imported by contracts/src.
/// @notice Records what the draw engine sends it, so the engine's career hook can be
///         asserted without deploying the real CareerStore in the same suite.
contract MockCareerStore is ICareerStore {
    struct Record {
        uint256 raceId;
        uint8 placement;
        int256 fatigueDelta;
    }

    mapping(uint256 => Record[]) private _records;

    address public drawEngine;

    event DrawEngineSet(address engine);

    function setDrawEngine(address engine) external {
        drawEngine = engine;
    }

    function recordRace(uint256 tokenId, uint256 raceId, uint8 placement, int256 fatigueDelta) external {
        _records[tokenId].push(Record({raceId: raceId, placement: placement, fatigueDelta: fatigueDelta}));
        emit RaceRecorded(tokenId, raceId, placement, fatigueDelta);
    }

    function recordCountOf(uint256 tokenId) external view returns (uint256) {
        return _records[tokenId].length;
    }

    function recordOf(uint256 tokenId, uint256 index) external view returns (uint256 raceId, uint8 placement, int256 fatigueDelta) {
        Record storage r = _records[tokenId][index];
        return (r.raceId, r.placement, r.fatigueDelta);
    }

    function getCareer(uint256 tokenId) external pure returns (Career memory c) {
        tokenId; // unused
        return c;
    }

    function trophiesOf(uint256 tokenId) external pure returns (uint32, uint32, uint32) {
        tokenId;
        return (0, 0, 0);
    }

    function fatigueOf(uint256 tokenId) external pure returns (uint256) {
        tokenId;
        return 0;
    }

    function currentFatigueOf(uint256 tokenId) external pure returns (uint256) {
        tokenId;
        return 0;
    }

    function fatigueMultiplierOf(uint256 tokenId) external pure returns (uint256) {
        tokenId;
        return 1e18;
    }

    function raceCountOf(uint256 tokenId) external pure returns (uint32) {
        tokenId;
        return 0;
    }

    function racesOf(uint256 tokenId) external pure returns (uint256[] memory) {
        tokenId;
        return new uint256[](0);
    }
}
