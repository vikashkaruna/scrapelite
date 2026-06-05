// runtime-config.js — RUNTIME endpoint overrides (read when the app loads, not
// baked in at build time like the VITE_* vars in .env).
//
// Why this exists: Vite inlines import.meta.env.VITE_* as string literals at
// BUILD time, so changing .env requires a rebuild/redeploy (and a restart in dev).
// Values set here are read at RUNTIME from this static file, so you can change an
// endpoint by editing this one file and reloading (dev) or redeploying just this
// file (prod) — no rebuild required.
//
// Precedence: a non-empty value here OVERRIDES the matching VITE_* value.
// Leave a value as "" to fall back to the build-time .env value.
// Auto-select the n8n MCP server URI based on environment.
// localhost → test endpoint (mcp-test); any other host → production endpoint (mcp).
// This file is read at runtime, so no rebuild is needed to switch environments.
var _isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
window.__SCRAPELITE_RUNTIME__ = {
  webhookUrl: _isLocal
    ? "https://vkaruna.app.n8n.cloud/mcp-test/scrapelite"
    : "https://vkaruna.app.n8n.cloud/mcp/scrapelite",
  emailApiUrl: "",
};
