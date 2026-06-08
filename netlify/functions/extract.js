// Netlify Function — Firecrawl proxy.
// Keeps FIRECRAWL_API_KEY server-side; never bundled into the browser.
//
// POST /api/extract
//   Body: { url: string, options: { renderJs?, customPrompt?, mapMode? } }
//   Response: raw Firecrawl JSON (scrape or map)

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";

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

function buildScrapePayload(url, options) {
  const formats = ["html"];
  const payload = { url, formats, onlyMainContent: false };
  if (options.renderJs) payload.waitFor = 3000;
  if (options.customPrompt) {
    formats.push("json");
    payload.jsonOptions = { prompt: options.customPrompt };
  }
  return payload;
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

  const { url, options = {} } = reqBody;
  if (!url) return respond(400, { error: "url is required" });

  // Non-VITE_ prefix is preferred for server-side secrets (set in Netlify dashboard).
  // Falls back to VITE_ prefix so local development with netlify dev works from .env.
  const apiKey =
    process.env.FIRECRAWL_API_KEY || process.env.VITE_FIRECRAWL_API_KEY;
  if (!apiKey) {
    return respond(503, { error: "Firecrawl not configured on this server" });
  }

  try {
    const isMap = Boolean(options.mapMode);
    const endpoint = isMap
      ? `${FIRECRAWL_BASE}/map`
      : `${FIRECRAWL_BASE}/scrape`;
    const payload = isMap ? { url } : buildScrapePayload(url, options);

    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      return respond(upstream.status, {
        error: `Firecrawl error (${upstream.status})`,
        detail: data,
      });
    }

    // For map responses, normalise the links array and surface it explicitly so
    // the browser can pick it up without knowing the raw Firecrawl shape.
    if (isMap) {
      const raw = data?.links || data?.data || [];
      const mapLinks = raw
        .map((l) => (typeof l === "string" ? l : l?.url))
        .filter(Boolean);
      return respond(200, { ...data, mapLinks });
    }

    return respond(200, data);
  } catch (err) {
    return respond(502, { error: `Upstream fetch failed: ${err.message}` });
  }
};
