import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// "web:fixtures" resolves to the dev-only mocks ONLY when VITE_FIXTURES=1.
// Production builds get fixtures/disabled.ts, so fixture code can never ship.
const fixturesEnabled = process.env.VITE_FIXTURES === "1";
const fixturesEntry = fixturesEnabled
  ? fileURLToPath(new URL("./src/fixtures/index.ts", import.meta.url))
  : fileURLToPath(new URL("./src/fixtures/disabled.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: "web:fixtures", replacement: fixturesEntry }],
  },
  build: { outDir: "dist" },
});
