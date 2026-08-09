import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { configDefaults } from "vitest/config";

// https://vite.dev/config
export default defineConfig({
  plugins: [
    react(),
    // The Vite proxy middleware logs ECONNREFUSED stack traces to
    // Vite's logger for every request when the proxy target
    // (Netlify Functions dev server on :9999) is unreachable — exactly
    // the case in the Playwright smoke suite, which only starts
    // `npm run dev` and not `netlify functions:serve`. The smoke
    // spec already accepts 502 as a valid "endpoint is wired" response
    // (see e2e/smoke/claims-verification.spec.js), so the error log is
    // pure noise that drowns out real test output.
    //
    // We can NOT override `config.logger.error` from a plugin — Vite
    // captures the logger reference in the proxy middleware before any
    // user plugin gets a chance to run. `console.error` is the channel
    // Vite's logger writes to (see dist/node/chunks/node.js:3176 →
    // output → console[method]), so intercepting it here is what
    // actually drops the noise.
    //
    // `apply: "serve"` is critical — it prevents this plugin from
    // running under Vitest, where the same Vite config file is loaded
    // to read the `test:` block. Vitest's tests don't make proxy
    // requests, so they don't produce proxy errors, but Vitest's
    // Vite plugin container will still call every plugin's
    // `configureServer` if `apply` is missing. With `apply: "serve"`,
    // Vitest sees a no-op plugin and the test process keeps its
    // original `console.error` — which is what the unit tests assume.
    //
    // Opt-out for debugging real proxy errors: set
    // DATIQ_QUIET_PROXY_ERRORS=0 in the env when running against a
    // real `netlify functions:serve` backend.
    {
      name: "datiq-quiet-proxy-errors",
      apply: "serve",
      configureServer() {
        if (process.env.DATIQ_QUIET_PROXY_ERRORS === "0") return;
        const PROXY_HEADER = /^(?:.*?)(?:http|ws) proxy error: /;
        const STACK_LINE = /^\s*at\s/;
        const origConsoleError = console.error.bind(console);
        let inProxyErr = false;
        console.error = function patchedError(...args) {
          const text = args
            .map((a) => (typeof a === "string" ? a : a && a.message ? a.message : String(a)))
            .join(" ");
          if (inProxyErr) {
            if (STACK_LINE.test(text) || /^\s*$/.test(text)) return;
            inProxyErr = false;
          }
          if (PROXY_HEADER.test(text)) {
            inProxyErr = true;
            return;
          }
          return origConsoleError(...args);
        };
      },
    },
  ],
  test: {
    environment: "jsdom",
    // setup.js handles jsdom polyfills + storage reset between specs.
    // a11y-setup.js wires the `toHaveNoViolations` matcher from
    // vitest-axe so every test can opt into a11y assertions.
    setupFiles: ["./test/setup.js", "./test/a11y-setup.js"],
    // Browser journeys are owned by Playwright. Keeping them out of Vitest
    // prevents its collector from executing Playwright's test hooks.
    exclude: [...configDefaults.exclude, "e2e/**", "**/.claude/worktrees/**"],
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
