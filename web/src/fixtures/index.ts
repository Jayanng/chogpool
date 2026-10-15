// CHOGPOOL_FIXTURE: DEV-ONLY MOCK. This entire directory is excluded from
// production builds (vite.config.ts resolves "web:fixtures" to disabled.ts when
// VITE_FIXTURES is unset; infra/check-fixtures.mjs fails CI if this marker or
// any fixture code reaches web/dist). Never import from here directly.

import type { GameSource } from "../types/game";

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
