#!/usr/bin/env node
// Chog Pool address-registry enforcement.
// RULE: no 0x{40-hex} literal may appear in source files outside infra/verified.json
// (allowlisted locations: infra/deployments.json, PLAN.md, lockfiles, generated files).
// Scanned: the SCAN_DIRS trees PLUS root-level tracked files (via git ls-files, so
// local and CI runs see exactly the same set).
// CI fails if a hardcoded address is found anywhere else.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ADDR_RE = /0x[a-fA-F0-9]{40}/g;
const ALLOW_FILES = [
  "infra/verified.json",
  "infra/deployments.json",
  "PLAN.md",             // the plan documents the verified addresses (read-only doc)
  "docs/GATE1-LOG.md",   // the recorded end-to-end run log: EVIDENCE, not source.
                         // It must quote the real addresses and hashes the run
                         // actually produced, or it is not a record of anything.
                         // Source files stay under the strict rule above.
  "docs/GATE2-LOG.md",   // gate evidence log: same rule as GATE1-LOG — it quotes the
                         // RPC values and addresses the checks actually produced.
  "package-lock.json",
  "pnpm-lock.yaml",
];
const SCAN_DIRS = ["contracts", "web", "packages", "infra", "docs", ".github"];
const SKIP = (p) =>
  p.includes("node_modules") || p.includes("/out/") || p.includes("/cache/") ||
  // Forge broadcast receipts contain every deployed address and every tx hash by
  // design — they are a record of a real run, not source. They are gitignored
  // build artifacts; without this skip the deploy would look like 380 violations.
  p.includes("/broadcast/") ||
  p.startsWith("contracts/lib/") || // vendored submodules (OpenZeppelin, forge-std) — NOT first-party code
  p.endsWith(".lock") || p.includes(".git/") || p.includes("/dist/");
const IS_GENERATED = (p) => p.includes("generated") || p.includes(".gen.");

let violations = 0;

function scanFile(rel, full) {
  if (ALLOW_FILES.includes(rel)) return;
  if (IS_GENERATED(rel)) return;
  const text = readFileSync(full, "utf8");
  for (const m of text.matchAll(ADDR_RE)) {
    const line = text.slice(0, m.index).split("\n").length;
    console.error(`HARDCODED ADDRESS: ${rel}:${line}  ${m[0]}`);
    violations++;
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full);
    if (SKIP(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) { walk(full); continue; }
    scanFile(rel, full);
  }
}

// sanity: registry itself must parse and contain the required keys
const reg = JSON.parse(readFileSync(join(ROOT, "infra/verified.json"), "utf8"));
const required = [
  ["monad.chogGenesisNFT.address", reg.monad?.chogGenesisNFT?.address],
  ["monad.chogToken.address", reg.monad?.chogToken?.address],
  ["monad.usdc.address", reg.monad?.usdc?.address],
  ["monad.aave.pool", reg.monad?.aave?.pool],
  ["monadTestnet.puddleUSDC.address", reg.monadTestnet?.puddleUSDC?.address],
  ["monadTestnet.puddleUSDT.address", reg.monadTestnet?.puddleUSDT?.address],
  ["monadTestnet.wmon.address", reg.monadTestnet?.wmon?.address],
  ["monadTestnet.stableFaucet.address", reg.monadTestnet?.stableFaucet?.address],
  ["monadTestnet.uniswapV2Factory.address", reg.monadTestnet?.uniswapV2Factory?.address],
  ["monadTestnet.uniswapV2Router02.address", reg.monadTestnet?.uniswapV2Router02?.address],
  ["monadTestnet.pairs.USDC_USDT.address", reg.monadTestnet?.pairs?.USDC_USDT?.address],
];
let missing = 0;
for (const [key, val] of required) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(val || "")) { console.error(`REGISTRY MISSING: ${key}`); missing++; }
}

for (const d of SCAN_DIRS) {
  if (!existsSync(join(ROOT, d))) continue;
  walk(join(ROOT, d));
}

// Root-level tracked files sit outside SCAN_DIRS — close that gap with git
// (git ls-files gives identical output locally and in a CI checkout).
try {
  const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const rel of tracked) {
    if (rel.includes("/")) continue; // files in directories are covered by walk() above
    const full = join(ROOT, rel);
    if (!existsSync(full)) continue;
    scanFile(rel, full);
  }
} catch {
  console.warn("check-addresses: git unavailable — root tracked-file scan skipped");
}

if (violations || missing) {
  console.error(`\nFAIL: ${violations} hardcoded address(es), ${missing} missing registry key(s).`);
  console.error("Add addresses to infra/verified.json (with source) and load them via the generated module.");
  process.exit(1);
}
console.log("check-addresses: OK (0 hardcoded, registry complete)");
