// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CareerStore} from "../src/CareerStore.sol";
import {ICareerStore} from "../interfaces/ICareerStore.sol";

/// @title CareerStore suite, the portable career record.
/// @notice Guards the properties the career page depends on: only the draw engine may
///         write, a race can only be recorded once, trophies land on the podium
///         places, and fatigue accrues on wins then decays over time.
contract CareerStoreTest is Test {
    CareerStore store;

    address owner_ = makeAddr("owner");
    address engine = makeAddr("engine");
    address stranger = makeAddr("stranger");

    uint256 constant TOKEN_A = 1;
    uint256 constant TOKEN_B = 2;

    function setUp() public {
        store = new CareerStore(owner_);
        vm.prank(owner_);
        store.setDrawEngine(engine);
    }

    function _record(uint256 tokenId, uint256 raceId, uint8 placement, int256 fatigueDelta) internal {
        vm.prank(engine);
        store.recordRace(tokenId, raceId, placement, fatigueDelta);
    }

    // ---------- access control ----------

    function test_OnlyDrawEngineCanRecord() public {
        vm.prank(stranger);
        vm.expectRevert(ICareerStore.NotDrawEngine.selector);
        store.recordRace(TOKEN_A, 1, 1, 0);
    }

    function test_OwnerCanRotateDrawEngine() public {
        address newEngine = makeAddr("newEngine");
        vm.prank(owner_);
        store.setDrawEngine(newEngine);

        vm.prank(newEngine);
        store.recordRace(TOKEN_A, 1, 1, 0);
        assertEq(store.raceCountOf(TOKEN_A), 1);
    }

    function test_SetDrawEngine_RejectsZero() public {
        vm.prank(owner_);
        vm.expectRevert(CareerStore.ZeroAddress.selector);
        store.setDrawEngine(address(0));
    }

    // ---------- recording ----------

    function test_RecordRace_FirstPlace_IsGold() public {
        _record(TOKEN_A, 1, 1, 0.1e18);

        (uint32 gold, uint32 silver, uint32 bronze) = store.trophiesOf(TOKEN_A);
        assertEq(gold, 1);
        assertEq(silver, 0);
        assertEq(bronze, 0);
        assertEq(store.raceCountOf(TOKEN_A), 1);
    }

    function test_RecordRace_SecondAndThird() public {
        _record(TOKEN_A, 1, 2, 0);
        _record(TOKEN_A, 2, 3, 0);

        (uint32 gold, uint32 silver, uint32 bronze) = store.trophiesOf(TOKEN_A);
        assertEq(gold, 0);
        assertEq(silver, 1);
        assertEq(bronze, 1);
    }

    /// Fourth place and beyond must not award a trophy, only the podium counts.
    function test_RecordRace_OffPodium_NoTrophy() public {
        _record(TOKEN_A, 1, 4, 0);
        _record(TOKEN_A, 2, 10, 0);

        (uint32 gold, uint32 silver, uint32 bronze) = store.trophiesOf(TOKEN_A);
        assertEq(gold + silver + bronze, 0, "no trophy off the podium");
        assertEq(store.raceCountOf(TOKEN_A), 2, "but the race still counts");
    }

    function test_RecordRace_RejectsPlacementZero() public {
        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(ICareerStore.InvalidPlacement.selector, 0));
        store.recordRace(TOKEN_A, 1, 0, 0);
    }

    /// A race can only be recorded once: a replayed draw event must not double-count.
    function test_RecordRace_CannotBeReplayed() public {
        _record(TOKEN_A, 1, 1, 0.1e18);

        vm.prank(engine);
        vm.expectRevert(abi.encodeWithSelector(ICareerStore.RaceAlreadyRecorded.selector, TOKEN_A, 1));
        store.recordRace(TOKEN_A, 1, 1, 0.1e18);

        assertEq(store.raceCountOf(TOKEN_A), 1);
        (uint32 gold,,) = store.trophiesOf(TOKEN_A);
        assertEq(gold, 1, "still exactly one gold");
    }

    function test_RecordRace_EmitsEvent() public {
        vm.expectEmit(true, true, false, true, address(store));
        emit ICareerStore.RaceRecorded(TOKEN_A, 7, 1, 0.1e18);
        _record(TOKEN_A, 7, 1, 0.1e18);
    }

    // ---------- fatigue: the Champion's Burden ----------

    function test_Fatigue_AccruesOnWin() public {
        _record(TOKEN_A, 1, 1, 0.5e18);
        assertEq(store.fatigueOf(TOKEN_A), 0.5e18);
        assertEq(store.currentFatigueOf(TOKEN_A), 0.5e18);
    }

    function test_Fatigue_ClampedAtMax() public {
        _record(TOKEN_A, 1, 1, 100e18);
        assertEq(store.fatigueOf(TOKEN_A), store.maxFatigue(), "fatigue is clamped");
    }

    /// A negative delta must not underflow the record.
    function test_Fatigue_NeverGoesNegative() public {
        _record(TOKEN_A, 1, 4, -50e18);
        assertEq(store.fatigueOf(TOKEN_A), 0);
    }

    function test_Fatigue_DecaysOverTime() public {
        _record(TOKEN_A, 1, 1, 1e18); // max fatigue
        assertEq(store.currentFatigueOf(TOKEN_A), 1e18);

        // Half the decay-per-day per half day: 0.1e18/day => 0.05e18 per 12h.
        vm.warp(block.timestamp + 12 hours);
        assertEq(store.currentFatigueOf(TOKEN_A), 0.95e18);

        // After 10 days the 1.0 fatigue is fully gone.
        vm.warp(block.timestamp + 10 days);
        assertEq(store.currentFatigueOf(TOKEN_A), 0);
    }

    function test_FatigueMultiplier_NeutralWhenFresh() public {
        assertEq(store.fatigueMultiplierOf(TOKEN_A), 1e18);
    }

    function test_FatigueMultiplier_WorstAtMaxFatigue() public {
        _record(TOKEN_A, 1, 1, 100e18); // clamped to maxFatigue
        assertEq(store.fatigueMultiplierOf(TOKEN_A), store.minMultiplier());
    }

    /// The multiplier must be monotonically decreasing in fatigue, a more burdened
    /// Chog can never be better off than a fresher one.
    function test_FatigueMultiplier_MonotonicInFatigue() public {
        _record(TOKEN_A, 1, 1, 0.25e18);
        _record(TOKEN_B, 1, 1, 0.75e18);

        uint256 multA = store.fatigueMultiplierOf(TOKEN_A);
        uint256 multB = store.fatigueMultiplierOf(TOKEN_B);
        assertGt(multA, multB, "less fatigue must mean a better multiplier");
        assertLe(multB, 1e18);
        assertGe(multA, store.minMultiplier());
    }

    // ---------- views ----------

    function test_GetCareer_ReturnsPortableRecord() public {
        _record(TOKEN_A, 1, 1, 0.2e18);
        _record(TOKEN_A, 2, 2, 0);
        _record(TOKEN_A, 3, 3, 0);

        ICareerStore.Career memory c = store.getCareer(TOKEN_A);
        assertEq(c.gold, 1);
        assertEq(c.silver, 1);
        assertEq(c.bronze, 1);
        assertEq(c.races, 3);
        assertEq(c.wins, 1);
        assertGt(c.lastRaceAt, 0);
        assertEq(c.fatigue, 0.2e18);
    }

    function test_RacesOf_ListsHistoryInOrder() public {
        _record(TOKEN_A, 5, 1, 0);
        _record(TOKEN_A, 9, 2, 0);
        _record(TOKEN_A, 17, 3, 0);

        uint256[] memory ids = store.racesOf(TOKEN_A);
        assertEq(ids.length, 3);
        assertEq(ids[0], 5);
        assertEq(ids[1], 9);
        assertEq(ids[2], 17);

        assertEq(store.placementOf(TOKEN_A, 5), 1);
        assertEq(store.placementOf(TOKEN_A, 9), 2);
        assertEq(store.placementOf(TOKEN_A, 17), 3);
    }

    /// Independent books per Chog: one Chog's career must not bleed into another's.
    function test_RecordsArePerToken() public {
        _record(TOKEN_A, 1, 1, 0.5e18);

        assertEq(store.raceCountOf(TOKEN_B), 0);
        assertEq(store.fatigueOf(TOKEN_B), 0);
        assertEq(store.racesOf(TOKEN_B).length, 0);
    }

    function test_SetFatigueParams_Validates() public {
        vm.startPrank(owner_);
        vm.expectRevert(CareerStore.BadParams.selector);
        store.setFatigueParams(0, 1e18, 0.5e18);
        vm.expectRevert(CareerStore.BadParams.selector);
        store.setFatigueParams(0.1e18, 1e18, 2e18); // multiplier above neutral
        vm.stopPrank();
    }
}
