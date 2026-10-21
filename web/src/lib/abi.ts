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
  "function withdrawAll(uint256 tokenId)",
]);

export const careerStoreAbi = parseAbi([
  "function getCareer(uint256 tokenId) view returns ((uint32 gold, uint32 silver, uint32 bronze, uint32 races, uint32 wins, uint32 lastRaceAt, uint256 fatigue))",
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

// The round engine deployed at gameEngine: one getter per view the UI binds to,
// plus the one player write, payRevive. RoundState is (None, Open, Closed,
// Settled) and reviveUsed is a public mapping, so its getter is part of the
// deployed interface even though it is not a declared function.
export const gameEngineAbi = parseAbi([
  "function latestRoundId() view returns (uint256)",
  "function roundState(uint256 roundId) view returns (uint8)",
  "function roundClosesAt(uint256 roundId) view returns (uint64)",
  "function participantCount(uint256 roundId) view returns (uint32)",
  "function courseSeedOf(uint256 roundId) view returns (bytes32)",
  "function potAtClose(uint256 roundId) view returns (uint256)",
  "function chogAtClose(uint256 roundId) view returns (uint256)",
  "function scoreOf(uint256 roundId, uint256 tokenId) view returns (uint256)",
  "function coinsOf(uint256 roundId, uint256 tokenId) view returns (uint256)",
  "function coinPayoutOf(uint256 roundId, uint256 tokenId) view returns (uint256)",
  "function coinRate() view returns (uint256)",
  "function revivedOf(uint256 roundId, uint256 tokenId) view returns (bool)",
  "function reviveUsed(uint256 roundId, uint256 tokenId) view returns (bool)",
  "function hasRun(uint256 roundId, uint256 tokenId) view returns (bool)",
  "function roundWinnersOf(uint256 roundId) view returns (uint256[3])",
  "function reviveFee() view returns (uint256)",
  "function payRevive(uint256 roundId, uint256 tokenId)",
  "event RoundOpened(uint256 indexed roundId, bytes32 courseSeed, uint64 closesAt)",
  "event RoundClosed(uint256 indexed roundId, uint256 potAtClose, uint256 chogAtClose)",
  "event RevivePaid(uint256 indexed roundId, uint256 indexed tokenId, uint256 fee)",
  "event ScoreRecorded(uint256 indexed roundId, uint256 indexed tokenId, uint256 score, uint256 coins, bool revived, address submittedBy, uint256 coinPayout)",
]);

export const testChogAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function claimAmount() view returns (uint256)",
  "function claimCooldown() view returns (uint64)",
  "function nextClaimAt(address account) view returns (uint64)",
  "function claim()",
  "function testLabel() view returns (string)",
  "event Claimed(address indexed account, uint256 amount, uint64 nextClaimAt)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
