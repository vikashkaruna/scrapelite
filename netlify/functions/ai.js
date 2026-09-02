// Netlify Function — multi-provider AI proxy with ordered fallback.
//
// POST /api/ai
//   Body: { model?, max_tokens?, messages: Array<{role, content}> }
//   Response: Anthropic-shaped { content: [{ type:"text", text }] }
//
// The chain is resolved server-side from admin-managed config (Supabase
// app_config 'ai' row) over the shared registry defaults — see
// lib/aiProviders.js and src/lib/providerRegistry.js. Provider keys stay
// server-side. The client-sent `model` is IGNORED (per-provider models come
// from config); `max_tokens`, `messages`, and now `area` are honored.
//
// `area` names the FUNCTION AREA this call belongs to (synthesis,
// classification, …). It selects an independently configurable chain and
// model tier, so writing a competitive brief and tagging 60 links stop
// sharing one model. It is validated against the allowlist — an unknown area
// falls back to the global chain rather than being rejected, because a client
// that is one deploy behind must not lose AI entirely.
//
// A failure returns a machine-readable `code` (no_credit / bad_key /
// rate_limited / …) and NOTHING ELSE. The browser used to see only a 502 and
// silently substituted locally-generated placeholder text, so a dead provider
// account looked exactly like a working one — hence the code.
//
// ⚠️ The code is all a customer gets. No `hint`, no provider names, no vendor
// error text, no attempt list: this endpoint is reachable by every signed-in
// user and by /api/v1 key holders, and "Your credit balance is too low to
// access the Anthropic API" is our billing state, not theirs. The full
// diagnosis goes to the server log and to the admin-gated endpoints. See
// lib/aiFailure.js.

import { runChain, keyPresence } from "./lib/aiProviders.js";
import { publicFailure, logChainFailure } from "./lib/aiFailure.js";
import { AI_AREA_KEYS, MODEL_TIER } from "../../src/lib/providerRegistry.js";
import { DENY_STATUS, denyBody, resolveRequestEntitlement, checkCapability } from "./lib/requireEntitlement.js";
import { buildWorkspaceCtx } from "./lib/workspaceContext.js";

const MAX_MESSAGES = 50;
// Raised from 20k/100k. The old ceiling predates sending page BODY text: a
// link-heavy page's summary prompt could exceed 20k characters on its own,
// which returned 400 → the browser caught it → the user silently got
// fabricated placeholder prose. The limits exist to bound abuse, not to
// bound legitimate page content.
const MAX_MESSAGE_CHARS = 120_000;
const MAX_TOTAL_CHARS = 200_000;
const MAX_TOKENS = 8192;

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null;
  let total = 0;
  const out = [];
  for (const message of messages) {
    if (!message || !["system", "user", "assistant"].includes(message.role)) return null;
    let content = message.content;
    if (Array.isArray(content)) {
      if (content.some((block) => !block || block.type !== "text" || typeof block.text !== "string")) return null;
      content = content.map((block) => ({ type: "text", text: block.text }));
      if (content.some((block) => block.text.length > MAX_MESSAGE_CHARS)) return null;
      total += content.reduce((n, block) => n + block.text.length, 0);
    } else if (typeof content === "string") {
      if (content.length > MAX_MESSAGE_CHARS) return null;
      total += content.length;
    } else return null;
    out.push({ role: message.role, content });
  }
  return total <= MAX_TOTAL_CHARS ? out : null;
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  let reqBody;
  try {
    reqBody = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }

  const { max_tokens, messages, workspaceId, area: rawArea, tier: rawTier } =
    reqBody && typeof reqBody === "object" ? reqBody : {};
  // Unknown area → global chain, never a rejection. A stale client must
  // degrade to the default, not lose AI.
  const area = AI_AREA_KEYS.includes(rawArea) ? rawArea : undefined;
  const tier = (rawTier === MODEL_TIER.FAST || rawTier === MODEL_TIER.DEEP) ? rawTier : undefined;

  const safeMessages = normalizeMessages(messages);
  if (!safeMessages) {
    return respond(400, { error: "messages array is required" });
  }
  if (max_tokens != null && (!Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > MAX_TOKENS)) {
    return respond(400, { error: `max_tokens must be an integer between 1 and ${MAX_TOKENS}` });
  }

  // Subscription gate — AI enrichment is a paid capability and must stop for a
  // lapsed subscriber. Signed-in users only; guests are unaffected. Fails OPEN
  // on infrastructure error (see lib/requireEntitlement.js).
  try {
    const resolved = await resolveRequestEntitlement(event);
    const { ctx, refusal } = await buildWorkspaceCtx(resolved, workspaceId);
    if (refusal) return respond(403, { error: refusal.message, code: refusal.code });
    const check = checkCapability(resolved, "ai", ctx);
    if (!check.allowed) return respond(DENY_STATUS, denyBody(check));
  } catch (err) {
    console.warn("[DatIQ] entitlement check errored (failing open):", err.message);
  }

  // No provider has a key → behave like the old "not configured" path (503) so
  // aiService.js falls back to its local mock content.
  const present = keyPresence();
  if (!Object.values(present).some(Boolean)) {
    // Generic prose + the code. An operator reads the real cause in
    // /admin/ai; a customer can act on neither wording, so they get the one
    // that discloses nothing.
    return respond(503, { error: "AI is temporarily unavailable.", code: "no_key" });
  }

  try {
    const result = await runChain(safeMessages, max_tokens, { area, tier });
    if (!result.ok) {
      // The full diagnosis goes to the LOG (an operator surface) and the code
      // alone goes to the caller. `detail.attempts` used to travel here
      // carrying each vendor's own error prose.
      logChainFailure("/api/ai", result);
      return respond(502, { error: "AI is temporarily unavailable.", ...publicFailure(result) });
    }
    // Normalize to the Anthropic messages shape the browser already parses.
    return respond(200, {
      content: [{ type: "text", text: result.text }],
      _provider: result.provider,
      _model: result.model,
      _tier: result.tier,
      _area: area || null,
    });
  } catch (err) {
    return respond(502, { error: `Upstream fetch failed: ${err.message}` });
  }
};
