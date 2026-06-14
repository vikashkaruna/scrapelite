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

  const { max_tokens, messages } = reqBody;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return respond(400, { error: "messages array is required" });
  }

  // No provider has a key → behave like the old "not configured" path (503) so
  // aiService.js falls back to its local mock content.
  const present = keyPresence();
  if (!Object.values(present).some(Boolean)) {
    return respond(503, { error: "AI service not configured on this server" });
  }

  try {
    const result = await runChain(messages, max_tokens);
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
