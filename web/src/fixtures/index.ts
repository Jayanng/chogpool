// CHOGPOOL_FIXTURE: DEV-ONLY MOCK. This entire directory is excluded from
// production builds (vite.config.ts resolves "web:fixtures" to disabled.ts when
// VITE_FIXTURES is unset; infra/check-fixtures.mjs fails CI if this marker or
// any fixture code reaches web/dist). Never import from here directly.

import type { GameSource } from "../types/game";
import type { RaceSource } from "../types/race";

type MockRace = {
  nextDrawAt: number | null;
  potUsdc: string;
  deposits: Map<string, string>;
};

const mock: MockRace = {
  // Fixture-only schedule: 48h from first load, clearly simulated (never shown as production data).
  nextDrawAt: Math.floor(Date.now() / 1000) + 48 * 60 * 60,
  potUsdc: "0.00",
  deposits: new Map<string, string>(),
};

export const fixtureGameSource: GameSource = {
  kind: "fixture",
  sentinel: "CHOGPOOL_FIXTURE_BUNDLE_SENTINEL", // scanned for in web/dist by infra/check-fixtures.mjs
  async nextDrawAt() {
    return mock.nextDrawAt;
  },
  async potBalance() {
    // Simulated pot: only the visual fixture ever produces this number.
    return BigInt(Math.round(parseFloat(mock.potUsdc) * 1e6));
  },
  async depositOf(tokenId) {
    const v = mock.deposits.get(tokenId.toString());
    return v === undefined ? 0n : BigInt(Math.round(parseFloat(v) * 1e6));
  },
  async twabOf(tokenId) {
    // Fixture book: the mock position stands still, so its TWAB is its balance.
    const v = mock.deposits.get(tokenId.toString());
    return v === undefined ? 0n : BigInt(Math.round(parseFloat(v) * 1e6));
  },
  async oddsBpsOf(tokenId) {
    const v = mock.deposits.get(tokenId.toString());
    const mine = v === undefined ? 0 : parseFloat(v);
    let total = 0;
    for (const d of mock.deposits.values()) total += parseFloat(d);
    return total === 0 ? 0n : BigInt(Math.floor((mine / total) * 10000));
  },
  async deposit(usdcAmount, tokenId) {
    const amount = parseFloat(usdcAmount);
    if (!Number.isFinite(amount) || amount <= 0) return { status: "error", detail: "Enter a USDC amount above zero." };
    mock.deposits.set(tokenId.toString(), (parseFloat(mock.deposits.get(tokenId.toString()) ?? "0") + amount).toFixed(6));
    return {
      status: "fixture-ok",
      detail: `Simulated deposit of ${amount} USDC bound to Chog #${tokenId.toString()}. No real funds moved (dev fixture).`,
    };
  },
  async withdrawAll(tokenId) {
    const v = mock.deposits.get(tokenId.toString()) ?? "0";
    mock.deposits.set(tokenId.toString(), "0");
    return {
      status: "fixture-ok",
      detail: `Simulated withdraw-all of ${v} USDC for Chog #${tokenId.toString()}. No real funds moved (dev fixture).`,
    };
  },
};

// Recorded draws, so the show and the verifier can be exercised in dev before
// the live stack has draws of its own. Draw 1's numbers are REAL: it is Draw 1
// as the first testnet stack recorded it (revealed at block 71255613, winner
// 1462 out of a 71,186,086-ticket book). The values are quoted, never invented,
// and the verifier recomputes them exactly the way it recomputes live draws.
// The CareerStore rows and the RaceRecorded line are a snapshot of what the
// store read shortly after that run's award (block 71255620): fatigue decays
// every block, so the live store reads a lower fatigue today while the medal,
// race and placement counts still match it. Draw 2 is derived from those same
// real values; its own comment says exactly how.
export const fixtureRaceSource: RaceSource = {
  kind: "fixture",
  sentinel: "CHOGPOOL_FIXTURE_BUNDLE_SENTINEL",
  async currentDrawId() {
    return 2n;
  },
  async getDraw(drawId) {
    if (drawId === 1n) {
      return {
        drawId: 1n,
        state: "finalized",
        closeAt: 1792068183,
        commitHash: "0x81fec32ffe3e8af0f2181dbc5d29761eba8849b05da20b34dd996d489e5c06a7",
        seed: "0x147a012d4a7e433805ac5d04b5c1f19335d3c4dae4f2cf388b11c9b970acf703",
        finalRandomness: "0xafb6d2d3faab8959a6dc32ef1d4eaa589d90bc8c6a736ddf967dcc3990c26c09",
        revealBlock: 71255613n,
        totalTickets: 71186086n,
        potPerWinner: 22941n,
        winners: [1462n],
        racers: [
          { tokenId: 1462n, tickets: 52934966n, tier: 0, boost: 0n },
          { tokenId: 954n, tickets: 18251120n, tier: 0, boost: 0n },
        ],
        sourceNote:
          "Source: Draw 1 of the first real testnet run. The commit, seed, reveal block, frozen book, winners, prize, CareerStore rows and RaceRecorded event are all quoted from that run's chain records, shown in this dev build so the derivation can be walked before the live stack has draws of its own.",
        recordedInscriptions: [
          {
            tokenId: 1462n,
            placement: 1,
            fatigueDelta: 100000000000000000n,
            blockNumber: 71255620n,
            txHash: "0x658a4e2b6adb8f77cee8e996c425408f104345467cc7afc487e65a874a108859",
          },
        ],
        recordedCareers: {
          // A snapshot of the rows as they read shortly after award, not a live
          // read: fatigue 37071759259259260n decays further every block (the
          // store reads lower today). No surface renders fatigue.
          "1462": { gold: 1, silver: 0, bronze: 0, races: 1, wins: 1, fatigue: 37071759259259260n, placementInRace: 1 },
          "954": { gold: 0, silver: 0, bronze: 0, races: 0, wins: 0, fatigue: 0n, placementInRace: 0 },
        },
      };
    }
    if (drawId !== 2n) return null;
    // MULTI-WIN: the same real Draw 1 seed, reveal block and frozen book,
    // awarded with two winner slots. Everything here is derived, never
    // invented: keccak256(seed, blockhash(71255613), uint256(2)) gives the
    // final randomness below, the same formula picks [1462, 954] for two
    // slots (slot 1 lands on the contract's duplicate walk, exactly as the
    // live chain's deriveWinners(1, 2) answered), and the prize is the first
    // run's 22,941-unit pot split two ways the way award() splits it. The
    // trophy rows are the placements an award records, 1 and 2 by payout
    // order; there is no second on-chain race, so no RaceRecorded event is
    // carried and the trophy copy stays on its plain-read wording. The draw is
    // flagged as a rehearsal so every surface shows it as one.
    return {
      drawId: 2n,
      rehearsal: true,
      state: "finalized",
      closeAt: 1792068183,
      commitHash: "0x81fec32ffe3e8af0f2181dbc5d29761eba8849b05da20b34dd996d489e5c06a7",
      seed: "0x147a012d4a7e433805ac5d04b5c1f19335d3c4dae4f2cf388b11c9b970acf703",
      finalRandomness: "0xd897cac8c786f3d036097ed7a86644a3bb0d18d0ae659dab0f95af2bf5f97158",
      revealBlock: 71255613n,
      totalTickets: 71186086n,
      potPerWinner: 11470n,
      winners: [1462n, 954n],
      racers: [
        { tokenId: 1462n, tickets: 52934966n, tier: 0, boost: 0n },
        { tokenId: 954n, tickets: 18251120n, tier: 0, boost: 0n },
      ],
      sourceNote:
        "Source: a dev-build rehearsal draw over the real Draw 1 seed, reveal block and frozen book, awarded with the two winner slots the same formula produces (the live chain's deriveWinners(1, 2) answered [1462, 954] the same way). Its final randomness is the same formula over drawId 2, its prize is the first run's pot split two ways, and its trophy rows are the placements an award records, 1 and 2 by payout order. No second on-chain race exists: no RaceRecorded event is claimed.",
      recordedInscriptions: [],
      recordedCareers: {
        "1462": { gold: 1, silver: 0, bronze: 0, races: 1, wins: 1, fatigue: 0n, placementInRace: 1 },
        "954": { gold: 0, silver: 1, bronze: 0, races: 1, wins: 0, fatigue: 0n, placementInRace: 2 },
      },
    };
  },
};
