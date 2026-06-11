// Netlify Function — Anthropic Claude proxy.
// Keeps AI_API_KEY server-side; the "dangerous-direct-browser-access" header is
// no longer needed because the request originates from a server context.
//
// POST /api/ai
//   Body: { model?, max_tokens?, messages: Array<{role, content}> }
//   Response: raw Anthropic messages API response

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

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

  const { model, max_tokens, messages } = reqBody;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return respond(400, { error: "messages array is required" });
  }

  const apiKey = process.env.AI_API_KEY || process.env.VITE_AI_API_KEY;
  if (!apiKey) {
    return respond(503, { error: "AI service not configured on this server" });
  }

  // Server-side model resolution: explicit request → env var → default.
  const resolvedModel =
    model ||
    process.env.AI_MODEL ||
    process.env.VITE_AI_MODEL ||
    DEFAULT_MODEL;

  try {
    const upstream = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: max_tokens || 1024,
        messages,
      }),
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      return respond(upstream.status, {
        error: `AI request failed (${upstream.status})`,
        detail: data,
      });
    }

    return respond(200, data);
  } catch (err) {
    return respond(502, { error: `Upstream fetch failed: ${err.message}` });
  }
};
