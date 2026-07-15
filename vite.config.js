import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { configDefaults } from "vitest/config";

// https://vite.dev/config
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.js"],
    // Browser journeys are owned by Playwright. Keeping them out of Vitest
    // prevents its collector from executing Playwright's test hooks.
    exclude: [...configDefaults.exclude, "e2e/**"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: [
        "src/lib/utils.js",
        "src/lib/linkCategorizer.js",
        "src/lib/extractionPresets.js",
        "src/lib/config.js",
        "src/lib/errorMessages.js",
        "src/lib/enrichmentStore.js",
      ],
      thresholds: {
        // Initial release gate for the critical client-side logic listed above.
        // Raise this as untested legacy export paths are brought under test.
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 70,
      },
    },
  },
  server: {
    port: 5173,
    open: true,
    // Dev-only proxy so `npm run dev` (plain Vite) can reach Netlify Functions
    // served separately by `netlify functions:serve` (or `netlify dev`).
    // Target port is configurable via FUNCTIONS_DEV_PORT (default 9999, the port
    // used by `netlify functions:serve`). Ignored in production builds.
    // Useful in git worktrees where `netlify dev` resolves the wrong base dir.
    proxy: {
      // Frontend calls /.netlify/functions/* directly (see paymentService FUNCTIONS const)
      "/.netlify/functions": {
        target: `http://localhost:${process.env.FUNCTIONS_DEV_PORT || "9999"}`,
        changeOrigin: true,
      },
      // /api/* → /.netlify/functions/* (matches netlify.toml redirect)
      "/api": {
        target: `http://localhost:${process.env.FUNCTIONS_DEV_PORT || "9999"}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/.netlify/functions"),
      },
    },
  },
});
