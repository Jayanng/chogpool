// Human-readable ABI fragments for the deployed contracts. Every function and
// event here exists in the contract source under contracts/src (and its frozen
// interfaces); the deployed testnet bytecode is checked against these with
// `cast` before any page relies on them. Addresses come only from the
// generated module.

import { parseAbi } from "viem";

export const drawEngineAbi = parseAbi([
  "function currentDrawId() view returns (uint256)",
  "function nextDrawAt() view returns (uint64)",
  "function commitWindow() view returns (uint64)",
  "function revealDeadline() view returns (uint64)",
  "function stateOf(uint256 drawId) view returns (uint8)",
  "function commitOf(uint256 drawId) view returns (bytes32)",
  "function seedOf(uint256 drawId) view returns (bytes32)",
  "function finalRandomnessOf(uint256 drawId) view returns (bytes32)",
  "function revealBlockOf(uint256 drawId) view returns (uint256)",
  "function drawNumber(uint256 drawId) view returns (uint256)",
  "function winnersOf(uint256 drawId) view returns (uint256[])",
  "function potPerWinnerOf(uint256 drawId) view returns (uint256)",
  "function totalTicketsOf(uint256 drawId) view returns (uint256)",
  "function ticketsOf(uint256 drawId, uint256 tokenId) view returns (uint256)",
  "function oddsBpsOf(uint256 drawId, uint256 tokenId) view returns (uint256)",
  "function drawCloseAt(uint256 drawId) view returns (uint64)",
  "function boostOf(uint256 tokenId) view returns (uint32 tier, uint256 boost)",
  "function winningZone(uint256 tokenId, uint256 tier, uint256 twab) view returns (uint256)",
  "function deriveWinners(uint256 drawId, uint256 winnerCount) view returns (uint256[])",
  "event DrawOpened(uint256 indexed drawId, uint64 openAt, uint64 closeAt)",
  "event DrawClosed(uint256 indexed drawId, uint64 closedAt)",
  "event Committed(uint256 indexed drawId, bytes32 commitHash)",
  "event Revealed(uint256 indexed drawId, bytes32 seed, bytes32 finalRandomness, uint256 revealBlock)",
  "event DrawAwarded(uint256 indexed drawId, uint256[] winnerTokenIds, uint256 potPerWinner)",
  "event DrawFinalized(uint256 indexed drawId)",
]);

export const poolAbi = parseAbi([
  "function nextDrawAt() view returns (uint64)",
  "function potBalance() view returns (uint256)",
  "function totalPrincipal() view returns (uint256)",
  "function lifetimePrincipal() view returns (uint256)",
  "function depositOf(uint256 tokenId) view returns (address depositor, uint256 shares, uint256 principal)",
  "function twabOf(uint256 tokenId) view returns (uint256)",
  "function sharesOf(uint256 tokenId) view returns (uint256)",
  "function oddsBpsOf(uint256 tokenId) view returns (uint256)",
  "function frozenRacers(uint256 drawId) view returns (uint256[])",
  "function ticketsOfFrozen(uint256 drawId, uint256 tokenId) view returns (uint256)",
  "function totalTicketsOfFrozen(uint256 drawId) view returns (uint256)",
  "function ticketsFrozen(uint256 drawId) view returns (bool)",
]);

export const careerStoreAbi = parseAbi([
  "function getCareer(uint256 tokenId) view returns (tuple(uint32 gold, uint32 silver, uint32 bronze, uint32 races, uint32 wins, uint32 lastRaceAt, uint256 fatigue))",
  "function trophiesOf(uint256 tokenId) view returns (uint32 gold, uint32 silver, uint32 bronze)",
  "function fatigueOf(uint256 tokenId) view returns (uint256)",
  "function currentFatigueOf(uint256 tokenId) view returns (uint256)",
  "function fatigueMultiplierOf(uint256 tokenId) view returns (uint256)",
  "function raceCountOf(uint256 tokenId) view returns (uint32)",
  "function racesOf(uint256 tokenId) view returns (uint256[])",
  "function placementOf(uint256 tokenId, uint256 raceId) view returns (uint8)",
  "event RaceRecorded(uint256 indexed tokenId, uint256 indexed raceId, uint8 placement, int256 fatigueDelta)",
  "event TrophyAwarded(uint256 indexed tokenId, uint8 place)",
  "event FatigueDecayed(uint256 indexed tokenId, uint256 from, uint256 to)",
]);

export const mirrorAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function uriHashOf(uint256 tokenId) view returns (bytes32)",
  "function badgeOf(uint256 tokenId) view returns (uint8)",
  "function isTestDrive(uint256 tokenId) view returns (bool)",
  "function hasTestDrive(address account) view returns (bool)",
  "function mainnetOwnerOf(uint256 tokenId) view returns (address)",
  "function totalMinted() view returns (uint256)",
  "event MirrorMinted(address indexed mainnetOwner, uint256 indexed tokenId, string realURI, bool isTestDrive)",
]);

export const testChogAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function claimAmount() view returns (uint256)",
  "function claimCooldown() view returns (uint64)",
  "function nextClaimAt(address account) view returns (uint64)",
  "function claim()",
  "function testLabel() view returns (string)",
  "event Claimed(address indexed account, uint256 amount, uint64 nextClaimAt)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
