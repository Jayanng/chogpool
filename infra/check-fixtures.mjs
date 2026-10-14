#!/usr/bin/env node
// Chog Pool fixture-exclusion enforcement.
// RULE: the production bundle (web/dist) must contain ZERO dev-fixture code.
//
// Three structural rules make this content-independent (a marker set bound to
// one file's current strings had two proven failure modes: spurious failure on
// honest UI copy, and silent pass when fixture code shipped via a module whose
// strings no one marked):
//
// R1  Every file in web/src/fixtures/ (except disabled.ts) must carry the
//     runtime sentinel string SENTINEL. A fixture module without it FAILS here.
// R2  Nothing outside web/src/fixtures/ may import fixture files directly. The
//     single sanctioned entry point is the "web:fixtures" specifier in
//     web/src/lib/game.ts (vite resolves it to disabled.ts for production).
// R3  web/dist must contain neither the sentinel nor the fixture-exclusive
//     runtime strings. The sentinel is a real object property value, so it
//     survives minification whenever fixture code is bundled.
//
// R4 (drift guard): every runtime marker must still exist in the fixture
// sources — if fixtures change wording, the checker demands an update instead
// of silently losing coverage.
//
// This script FAILS (exit 1) if fixture code reached the production build.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "web", "dist");
const FIXTURES_DIR = join(ROOT, "web", "src", "fixtures");
const ENTRY_ALLOWED = "web/src/lib/game.ts"; // the only file importing "web:fixtures"

const SENTINEL = "CHOGPOOL_FIXTURE_BUNDLE_SENTINEL";
// Strings produced ONLY by web/src/fixtures/ runtime code (never by honest UI copy).
const RUNTIME_MARKERS = ["Simulated deposit of", "(dev fixture)", "fixture-ok"];

let failures = 0;

if (!existsSync(DIST)) {
  console.error("check-fixtures: web/dist not found — run `pnpm run build:web` first.");
  process.exit(1);
}

// ---- R1 + R4: fixture sources must carry the sentinel; markers must not drift
const fixtureSources = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".ts"));
const allFixtureText = fixtureSources.map((f) => readFileSync(join(FIXTURES_DIR, f), "utf8")).join("\n");

for (const f of fixtureSources) {
  if (f === "disabled.ts") continue; // the production stand-in must stay sentinel-free
  const text = readFileSync(join(FIXTURES_DIR, f), "utf8");
  if (!text.includes(SENTINEL)) {
    console.error(`FIXTURE WITHOUT SENTINEL: web/src/fixtures/${f} must contain "${SENTINEL}" (runtime string, e.g. as an object property).`);
    failures++;
  }
}
for (const marker of RUNTIME_MARKERS) {
  if (!allFixtureText.includes(marker)) {
    console.error(`MARKER DRIFT: "${marker}" no longer exists in web/src/fixtures/ — update RUNTIME_MARKERS alongside the fixture copy.`);
    failures++;
  }
}

// ---- R2: no direct fixture imports outside the sanctioned entry point
function walkSrc(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walkSrc(full); continue; }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    const rel = relative(ROOT, full).replaceAll("\\", "/");
    if (rel.startsWith("web/src/fixtures/")) continue;
    if (rel === ENTRY_ALLOWED) continue;
    const text = readFileSync(full, "utf8");
    const bad = text.match(/(?:from\s+|import\s*\(\s*|import\s+)["'][^"']*\/fixtures(\/[^"']*)?["']/);
    if (bad) {
      console.error(`DIRECT FIXTURE IMPORT: ${rel} → ${bad[0]} (only ${ENTRY_ALLOWED} may touch fixtures, via "web:fixtures")`);
      failures++;
    }
  }
}
walkSrc(join(ROOT, "web", "src"));

// ---- R3: production bundle must be free of sentinel + fixture runtime strings
function walkDist(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walkDist(full); continue; }
    const text = readFileSync(full, "utf8");
    for (const marker of [SENTINEL, ...RUNTIME_MARKERS]) {
      if (text.includes(marker)) {
        console.error(`FIXTURE LEAK: ${relative(ROOT, full)} contains "${marker}"`);
        failures++;
      }
    }
  }
}
walkDist(DIST);

if (failures > 0) {
  console.error(`\nFAIL: ${failures} fixture-exclusion violation(s).`);
  console.error("Production builds must resolve web:fixtures to fixtures/disabled.ts (VITE_FIXTURES unset).");
  process.exit(1);
}
console.log("check-fixtures: OK (production bundle is fixture-free, sources sentinel-complete)");
