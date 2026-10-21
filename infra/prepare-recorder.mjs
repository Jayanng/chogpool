// Regenerate api/_gen, the recorder's compiled copy of the pure game chain.
// The serverless bundler only ships files that exist at the exact paths a
// function imports, and web/src/game/runRecord.ts is not such a file. The
// source of truth stays web/src; this step compiles the pure modules the
// recorder shares with the Proof page into api/_gen so the function bundles
// them. Run after any change to the sim chain, then commit the result, exactly
// like the generated address registry.
//
//   node infra/prepare-recorder.mjs

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "web", "node_modules", ".bin", "tsc");
if (!existsSync(tsc)) {
  console.error("prepare-recorder: web's tsc is missing. Run pnpm install first.");
  process.exit(1);
}
execFileSync(tsc, ["-p", join(root, "tsconfig.recorder.json")], { cwd: root, stdio: "inherit" });
console.log("prepare-recorder: api/_gen regenerated.");
