#!/usr/bin/env node
// Generates web/src/generated/addresses.gen.ts from infra/verified.json.
// The ONLY place address literals may enter the TS app.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const reg = JSON.parse(readFileSync(join(ROOT, "infra/verified.json"), "utf8"));

const t = `// GENERATED from infra/verified.json — do not edit by hand.
// Source of truth: infra/verified.json (verified live 2026-10-14).
export const CHAIN = {
  monad: { id: ${reg.monad.chainId}, name: ${JSON.stringify(reg.monad.name)}, rpc: ${JSON.stringify(reg.monad.rpc)} },
  monadTestnet: { id: ${reg.monadTestnet.chainId}, name: ${JSON.stringify(reg.monadTestnet.name)}, rpc: ${JSON.stringify(reg.monadTestnet.rpc)} },
} as const;

export const MAINNET = {
  chogGenesisNFT: "${reg.monad.chogGenesisNFT.address}",
  chogToken: "${reg.monad.chogToken.address}",
  usdc: "${reg.monad.usdc.address}",
  aavePool: "${reg.monad.aave.pool}",
  aMonUSDC: "${reg.monad.aave.aMonUSDC}",
} as const;

export const TESTNET = {
  usdc: "${reg.monadTestnet.puddleUSDC.address}",
  usdt: "${reg.monadTestnet.puddleUSDT.address}",
  wmon: "${reg.monadTestnet.wmon.address}",
  stableFaucet: "${reg.monadTestnet.stableFaucet.address}",
  v2Factory: "${reg.monadTestnet.uniswapV2Factory.address}",
  v2Router: "${reg.monadTestnet.uniswapV2Router02.address}",
  pairUSDCUSDT: "${reg.monadTestnet.pairs.USDC_USDT.address}",
  pairUSDCWMON: "${reg.monadTestnet.pairs.USDC_WMON.address}",
  pairUSDTWMON: "${reg.monadTestnet.pairs.USDT_WMON.address}",
} as const;

export const IPFS = {
  metadataBase: "${reg.ipfs.chogMetadataCid}",
  gateway: "${reg.ipfs.gateway}",
} as const;
`;

const out = join(ROOT, "web/src/generated");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "addresses.gen.ts"), t);
console.log("wrote web/src/generated/addresses.gen.ts");
