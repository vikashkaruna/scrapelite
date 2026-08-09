// vite.config.test.js
//
// Guard tests for the Vite dev-server config — the bits that, if mis-edited,
// silently break `npm run dev` (local) or `npm run test:e2e:smoke` (CI).
// Cheaper than debugging "why is my dev server noisy" hours later.
//
// Run with: npx vitest run vite.config.test.js

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const viteConfigSource = readFileSync(
  resolve(__dirname, "vite.config.js"),
  "utf8"
);

describe("vite.config.js — dev proxy", () => {
  it("proxies /.netlify/functions to the functions dev port (default 9999)", () => {
    // The smoke spec (`npm run dev` alone, no `netlify functions:serve`)
    // relies on the proxy target being configurable via FUNCTIONS_DEV_PORT.
    expect(viteConfigSource).toMatch(
      /"\/\.netlify\/functions":\s*\{[\s\S]*?target:\s*`http:\/\/localhost:\$\{process\.env\.FUNCTIONS_DEV_PORT\s*\|\|\s*"9999"\}/
    );
  });

  it("proxies /api/* with a rewrite to /.netlify/functions/*", () => {
    // The frontend's apiClient calls /api/*; netlify.toml's redirect
    // does the same on prod. The dev proxy must match.
    expect(viteConfigSource).toMatch(
      /"\/api":\s*\{[\s\S]*?rewrite:\s*\(path\)\s*=>\s*path\.replace\(\s*\/\^\\\/api\/,\s*"\/\.netlify\/functions"\s*\)/
    );
  });

  it("swallows proxy ECONNREFUSED logs via a custom plugin", () => {
    // The Playwright smoke spec runs `npm run dev` alone (no
    // `netlify functions:serve` alongside), so the proxy target is
    // unreachable and Vite logs an ECONNREFUSED stack trace for every
    // request. The smoke spec already accepts 502 as a valid
    // "endpoint is wired" answer, so the log is pure noise.
    //
    // The fix is a dedicated `datiq-quiet-proxy-errors` plugin that
    // intercepts `console.error` (the channel Vite's logger writes to
    // — see dist/node/chunks/node.js:3176 → output → console[method]) and
    // drops only the proxy-error patterns plus their trailing stack
    // lines. Other error / warning / test output passes through.
    expect(viteConfigSource).toMatch(/datiq-quiet-proxy-errors/);
    expect(viteConfigSource).toMatch(/configureServer\(\)/);
    expect(viteConfigSource).toMatch(/console\.error\s*=/);
    expect(viteConfigSource).toMatch(/proxy error:/);
    // The override is opt-out via env var so a developer running
    // against a real `netlify functions:serve` backend can still see
    // the proxy errors when they need to debug a real ECONNREFUSED.
    expect(viteConfigSource).toMatch(/DATIQ_QUIET_PROXY_ERRORS/);
  });

  it("uses port 5173 (Vite default) — referenced by AGENTS.md and README", () => {
    expect(viteConfigSource).toMatch(/port:\s*5173/);
  });
});
