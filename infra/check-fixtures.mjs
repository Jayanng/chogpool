#!/usr/bin/env node
// Chog Pool fixture-exclusion enforcement.
// RULE: the production bundle (web/dist) must contain ZERO dev-fixture code.
// Fixtures live in web/src/fixtures/ behind the "web:fixtures" alias, which
// vite.config.ts resolves to disabled.ts unless VITE_FIXTURES=1.
// Detection uses RUNTIME STRINGS from the mock (minification strips comments
// and identifiers, so a comment marker alone can never prove anything — that
// mistake shipped a false "fixture-free" pass in the first Phase 2 audit).
// This script FAILS (exit 1) if fixture code reached the production build.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "web", "dist");

// Strings that exist ONLY in web/src/fixtures/index.ts (the mock's output text).
const MARKERS = [
  "Simulated deposit of",
  "No real funds moved",
  "fixture-ok",
  "CHOGPOOL_FIXTURE", // unminified builds (dev) also catch the banner comment
];

let hits = 0;

if (!existsSync(DIST)) {
  console.error("check-fixtures: web/dist not found — run `pnpm run build:web` first.");
  process.exit(1);
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    const text = readFileSync(full, "utf8");
    for (const marker of MARKERS) {
      if (text.includes(marker)) {
        console.error(`FIXTURE LEAK: ${relative(ROOT, full)} contains "${marker}"`);
        hits++;
      }
    }
  }
}

walk(DIST);

if (hits > 0) {
  console.error(`\nFAIL: ${hits} fixture leak(s) in the production bundle.`);
  console.error("Production builds must resolve web:fixtures to fixtures/disabled.ts (VITE_FIXTURES unset).");
  process.exit(1);
}
console.log("check-fixtures: OK (production bundle is fixture-free)");
