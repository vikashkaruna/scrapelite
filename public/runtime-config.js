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
window.__SCRAPELITE_RUNTIME__ = {
  // Production webhook — always active (workflow is live in n8n).
  // For active n8n editor testing, temporarily swap to:
  //   "https://vkaruna.app.n8n.cloud/webhook-test/scrapelite"
  webhookUrl: "https://vkaruna.app.n8n.cloud/webhook/scrapelite",
  emailApiUrl: "",
};
