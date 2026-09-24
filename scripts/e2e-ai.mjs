// scripts/e2e-ai.mjs — end-to-end harness for the multi-provider AI chain.
//
// Drives the REAL Netlify function handlers (ai.js, admin-ai-config.js) and the
// real adapter/config/auth code, with global fetch mocked per-provider so every
// path is exercised deterministically (no external keys / network needed).
//
//   node scripts/e2e-ai.mjs
//
// Exits non-zero if any assertion fails.

import { createHmac } from "node:crypto";

// Exact host match — a substring check would also accept "api.example.com.evil.test".
const hostIs = (url, host) => { try { return new URL(String(url)).hostname === host; } catch { return false; } };

// ── dummy server env (keys are read live by keyFor/keyPresence) ────────────────
process.env.GEMINI_API_KEY = "test-gemini";
process.env.AI_API_KEY     = "test-anthropic";
process.env.OPENAI_API_KEY = "test-openai";
delete process.env.AI_PROVIDER_ORDER;       // use built-in default order
delete process.env.SUPABASE_URL;            // start with no Supabase
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.ADMIN_PIN_HASH;
delete process.env.ADMIN_PIN;
delete process.env.ADMIN_TOKEN_SECRET;

// ── controllable fetch mock ────────────────────────────────────────────────────
// MODE.fail = Set of providers that should return HTTP 500. Everything else 200.
const MODE = { fail: new Set() };
const calls = []; // { host, url, opts }

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  let body = {};
  try { body = opts.body ? JSON.parse(opts.body) : {}; } catch {}

  if (hostIs(u, "generativelanguage.googleapis.com")) {
    calls.push({ host: "gemini", url: u, opts, body });
    if (MODE.fail.has("gemini")) return jsonRes(500, { error: { message: "gemini boom" } });
    return jsonRes(200, { candidates: [{ content: { parts: [{ text: "GEMINI_OK" }] } }] });
  }
  if (hostIs(u, "api.anthropic.com")) {
    calls.push({ host: "anthropic", url: u, opts, body });
    if (MODE.fail.has("anthropic")) return jsonRes(500, { error: { message: "anthropic boom" } });
    return jsonRes(200, { content: [{ type: "text", text: "ANTHROPIC_OK" }] });
  }
  if (hostIs(u, "api.openai.com")) {
    calls.push({ host: "openai", url: u, opts, body });
    if (MODE.fail.has("openai")) return jsonRes(500, { error: { message: "openai boom" } });
    return jsonRes(200, { choices: [{ message: { content: "OPENAI_OK" } }] });
  }
  // Supabase app_config: GET (read) → [], POST (upsert) → 201
  if (u.includes("/rest/v1/app_config")) {
    calls.push({ host: "supabase", url: u, opts, body });
    if ((opts.method || "GET").toUpperCase() === "POST") return jsonRes(201, []);
    return jsonRes(200, []); // empty → server uses defaults
  }
  throw new Error("Unexpected fetch to " + u);
};

// ── import the real code AFTER fetch is mocked ─────────────────────────────────
const { handler: aiHandler } = await import("../netlify/functions/ai.js");
const { handler: cfgHandler } = await import("../netlify/functions/admin-ai-config.js");
const { verifyAdminToken } = await import("../netlify/functions/lib/adminToken.js");

// ── tiny test runner ───────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m " + label); }
  else { fail++; console.log("  \x1b[31m✗ " + label + "\x1b[0m"); }
}
const MESSAGES = [
  { role: "system", content: "You are a classifier." },
  { role: "user", content: "Categorize these links." },
];
const callAi = async (max_tokens = 400) =>
  JSON.parse((await aiHandler({ httpMethod: "POST", body: JSON.stringify({ model: "ignored-by-server", max_tokens, messages: MESSAGES }) })).body);

// signs a token the same way admin-auth.js does
function signToken(secret, exp = Date.now() + 60000) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

console.log("\n=== /api/ai — provider paths & fallback ===");

// Path 1 — Gemini (primary) succeeds
MODE.fail = new Set();
let r = await callAi();
ok(r._provider === "gemini" && r.content?.[0]?.text === "GEMINI_OK", "Path 1: Gemini primary succeeds → GEMINI_OK");

// Path 2 — Gemini fails → Anthropic
MODE.fail = new Set(["gemini"]);
r = await callAi();
ok(r._provider === "anthropic" && r.content[0].text === "ANTHROPIC_OK", "Path 2: Gemini fails → Anthropic fallback → ANTHROPIC_OK");

// Path 3 — Gemini + Anthropic fail → OpenAI
MODE.fail = new Set(["gemini", "anthropic"]);
r = await callAi();
ok(r._provider === "openai" && r.content[0].text === "OPENAI_OK", "Path 3: Gemini+Anthropic fail → OpenAI fallback → OPENAI_OK");

// Path 4 — all fail → 502
MODE.fail = new Set(["gemini", "anthropic", "openai"]);
let raw = await aiHandler({ httpMethod: "POST", body: JSON.stringify({ messages: MESSAGES }) });
let body = JSON.parse(raw.body);
ok(raw.statusCode === 502 && /providers failed/i.test(body.error), "Path 4: all providers fail → 502 with attempts");
ok(Array.isArray(body.detail?.attempts) && body.detail.attempts.length === 3, "Path 4: all 3 attempts recorded");

// Path 5 — no key for primary → skipped, falls to next with a key
MODE.fail = new Set();
const savedGem = process.env.GEMINI_API_KEY;
delete process.env.GEMINI_API_KEY;
r = await callAi();
ok(r._provider === "anthropic", "Path 5: missing GEMINI_API_KEY → Gemini skipped → Anthropic answers");
process.env.GEMINI_API_KEY = savedGem;

// Path 6 — no keys at all → 503 (lets aiService fall back to local mock)
const bak = { g: process.env.GEMINI_API_KEY, a: process.env.AI_API_KEY, o: process.env.OPENAI_API_KEY };
delete process.env.GEMINI_API_KEY; delete process.env.AI_API_KEY; delete process.env.OPENAI_API_KEY;
delete process.env.VITE_AI_API_KEY;
raw = await aiHandler({ httpMethod: "POST", body: JSON.stringify({ messages: MESSAGES }) });
ok(raw.statusCode === 503, "Path 6: no provider keys → 503 (mock-fallback signal)");
process.env.GEMINI_API_KEY = bak.g; process.env.AI_API_KEY = bak.a; process.env.OPENAI_API_KEY = bak.o;

console.log("\n=== adapter request shaping (per provider) ===");
// validate the actual outbound request each adapter built
const gem = [...calls].reverse().find((c) => c.host === "gemini");
ok(/:generateContent\?key=/.test(gem.url) && gem.body.contents?.[0]?.role === "user", "Gemini: generateContent URL + role-mapped contents");
ok(gem.body.systemInstruction?.parts?.[0]?.text?.includes("classifier"), "Gemini: system message → systemInstruction");
const ant = [...calls].reverse().find((c) => c.host === "anthropic");
ok(ant.opts.headers["x-api-key"] === "test-anthropic" && ant.opts.headers["anthropic-version"], "Anthropic: x-api-key + anthropic-version headers");
ok(ant.body.max_tokens === 400 && Array.isArray(ant.body.messages), "Anthropic: honors client max_tokens (400) + messages");
const oai = [...calls].reverse().find((c) => c.host === "openai");
ok(oai.opts.headers.Authorization === "Bearer test-openai" && oai.body.model === "gpt-4o-mini", "OpenAI: Bearer auth + default model gpt-4o-mini");

console.log("\n=== /api/admin-ai-config — read / write / auth ===");
// GET (no Supabase) → config + key presence, persisted:false
let g = JSON.parse((await cfgHandler({ httpMethod: "GET" })).body);
ok(g.ok && g.config.order.join(",") === "gemini,anthropic,openai", "GET: returns default order Gemini→Claude→OpenAI");
ok(g.keyPresence.gemini && g.keyPresence.anthropic && g.keyPresence.openai, "GET: reports all keys present");
ok(g.persisted === false, "GET: persisted=false when Supabase unconfigured");

// POST without token, non-demo (secret set) → 401
process.env.ADMIN_TOKEN_SECRET = "topsecret";
let p = await cfgHandler({ httpMethod: "POST", body: JSON.stringify({ order: ["openai", "gemini"] }) });
ok(p.statusCode === 401, "POST: missing token (non-demo) → 401");

// POST with tampered token → 401
p = await cfgHandler({ httpMethod: "POST", headers: { Authorization: "Bearer abc.def" }, body: JSON.stringify({ order: ["openai"] }) });
ok(p.statusCode === 401, "POST: tampered token → 401");

// POST with valid token, no Supabase → 200 persisted:false
const token = signToken("topsecret");
p = JSON.parse((await cfgHandler({ httpMethod: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ order: ["openai", "anthropic", "gemini"], maxTokens: 2048 }) })).body);
ok(p.ok && p.persisted === false, "POST: valid token, no Supabase → ok + persisted:false (warned)");

// POST with valid token + Supabase configured → 200 persisted:true (upsert called)
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "service-key";
const before = calls.filter((c) => c.host === "supabase" && (c.opts.method || "").toUpperCase() === "POST").length;
p = JSON.parse((await cfgHandler({ httpMethod: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ order: ["openai", "anthropic", "gemini"], enabled: { gemini: false }, maxTokens: 2048 }) })).body);
const after = calls.filter((c) => c.host === "supabase" && (c.opts.method || "").toUpperCase() === "POST").length;
ok(p.ok && p.persisted === true, "POST: valid token + Supabase → persisted:true");
ok(after === before + 1, "POST: upsert issued to app_config");
ok(p.value.order.join(",") === "openai,anthropic,gemini" && p.value.enabled.gemini === false && p.value.maxTokens === 2048, "POST: sanitized value persisted (order/enabled/maxTokens)");

// sanitize drops unknown providers
p = JSON.parse((await cfgHandler({ httpMethod: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ order: ["openai", "bogus", "gemini"] }) })).body);
ok(p.value.order.join(",") === "openai,gemini", "POST: unknown provider 'bogus' stripped from order");

console.log("\n=== adminToken verification ===");
ok(verifyAdminToken(signToken("topsecret")).ok === true, "token: valid signature → ok");
ok(verifyAdminToken(signToken("wrongsecret")).ok === false, "token: wrong secret → rejected");
ok(verifyAdminToken(signToken("topsecret", Date.now() - 1000)).ok === false, "token: expired → rejected");
ok(verifyAdminToken("").ok === false, "token: empty → rejected");
delete process.env.ADMIN_TOKEN_SECRET; delete process.env.ADMIN_PIN_HASH; delete process.env.ADMIN_PIN;
ok(verifyAdminToken("anything").demo === true, "token: demo mode (no admin secret) → accepted as demo");

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
