#!/usr/bin/env node
// Generates web/src/generated/addresses.gen.ts from infra/verified.json.
// The ONLY place address literals may enter the TS app.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const reg = JSON.parse(readFileSync(join(ROOT, "infra/verified.json"), "utf8"));

// Our own deployed contracts (testnet). Optional: a checkout with no deployment yet
// must still generate a working module, so the app can build and run before the
// first deploy. The DEPLOYED export is then null and the UI shows honest
// "not deployed" states rather than reading a zero address.
const depPath = join(ROOT, "infra/deployments.json");
const dep = existsSync(depPath) ? JSON.parse(readFileSync(depPath, "utf8")) : null;

// The deployment must be for the chain the registry describes. A stale
// deployments.json left over from a previous network would silently point the app
// at contracts that do not exist here, so it is ignored loudly instead.
if (dep && dep.chainId !== reg.monadTestnet.chainId) {
  console.error(
    `gen-addresses: ignoring infra/deployments.json — it records chainId ${dep.chainId}, ` +
      `but the registry describes testnet chainId ${reg.monadTestnet.chainId}.`
  );
  dep = null;
}

const deployedBlock = dep
  ? `export const DEPLOYED = {
  chainId: ${dep.chainId},
  mirror: "${dep.mirror}",
  pool: "${dep.pool}",
  yieldAdapter: "${dep.yieldAdapter}",
  drawEngine: "${dep.drawEngine}",
  careerStore: "${dep.careerStore}",
  testChogToken: "${dep.testChogToken}",
  deployedAt: ${dep.deployedAt},
} as const;
`
  : `export const DEPLOYED = null;
`;

const t = `// GENERATED from infra/verified.json + infra/deployments.json — do not edit by hand.
// Source of truth: infra/verified.json (verified live 2026-10-14).
// DEPLOYED is our own testnet deployment; null when nothing is deployed yet.
export const CHAIN = {
  monad: { id: ${reg.monad.chainId}, name: ${JSON.stringify(reg.monad.name)}, rpc: ${JSON.stringify(reg.monad.rpc)}, explorer: ${JSON.stringify(reg.monad.explorer)} },
  monadTestnet: { id: ${reg.monadTestnet.chainId}, name: ${JSON.stringify(reg.monadTestnet.name)}, rpc: ${JSON.stringify(reg.monadTestnet.rpc)}, explorer: ${JSON.stringify(reg.monadTestnet.explorer)} },
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
  faucetUsdc: "${reg.monadTestnet.faucetUSDC.address}",
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

${deployedBlock}`;

const out = join(ROOT, "web/src/generated");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "addresses.gen.ts"), t);
console.log("wrote web/src/generated/addresses.gen.ts");
