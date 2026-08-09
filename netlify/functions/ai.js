// Netlify Function — multi-provider AI proxy with ordered fallback.
//
// POST /api/ai
//   Body: { model?, max_tokens?, messages: Array<{role, content}> }
//   Response: Anthropic-shaped { content: [{ type:"text", text }] }
//
// The chain (Gemini → Anthropic → OpenAI by default) is resolved server-side from
// admin-managed config (Supabase app_config 'ai' row) with env/static fallback —
// see lib/aiProviders.js. Provider keys stay server-side. The client-sent `model`
// is IGNORED (per-provider models come from config); only `max_tokens` (the
// per-call budget) and `messages` are honored.

import { runChain, keyPresence } from "./lib/aiProviders.js";
import { DENY_STATUS, denyBody, requireCapability } from "./lib/requireEntitlement.js";

const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 100_000;
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

  const { max_tokens, messages } = reqBody && typeof reqBody === "object" ? reqBody : {};

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
    const { check } = await requireCapability(event, "ai");
    if (!check.allowed) return respond(DENY_STATUS, denyBody(check));
  } catch (err) {
    console.warn("[DatIQ] entitlement check errored (failing open):", err.message);
  }

  // No provider has a key → behave like the old "not configured" path (503) so
  // aiService.js falls back to its local mock content.
  const present = keyPresence();
  if (!Object.values(present).some(Boolean)) {
    return respond(503, { error: "AI service not configured on this server" });
  }

  try {
    const result = await runChain(safeMessages, max_tokens);
    if (!result.ok) {
      return respond(502, { error: result.error, detail: { attempts: result.attempts } });
    }
    // Normalize to the Anthropic messages shape the browser already parses.
    return respond(200, {
      content: [{ type: "text", text: result.text }],
      _provider: result.provider,
      _model: result.model,
    });
  } catch (err) {
    return respond(502, { error: `Upstream fetch failed: ${err.message}` });
  }
};
