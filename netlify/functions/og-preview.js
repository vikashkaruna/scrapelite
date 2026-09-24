// Netlify Function — lightweight OG/meta preview fetcher.
// Reads only the first 15 KB of a page to extract <title>, og:title,
// og:description, and meta description. Never returns the full body.
//
// GET /api/og-preview?url=https://example.com
// Response: { url, hostname, favicon, title, description }

import { isPublicHttpUrlAsync, fetchPublicUrl } from "./lib/publicUrl.js";
import { decodeHtmlEntities } from "./lib/htmlEntities.js";

const FETCH_TIMEOUT_MS = 5000;
const HEAD_BYTES = 15000;

function headers(extra = {}) {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=300",
    ...extra,
  };
}

function respond(code, body) {
  return { statusCode: code, headers: headers(), body: JSON.stringify(body) };
}

// Parse OG/meta tags from an HTML string. Tries og:* first, falls back to
// standard meta name="description" and <title>.
function parseOg(html) {
  // property=  or  content= can appear in either order in the tag
  const prop = (name) => {
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["']`, "i"),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return decodeHtmlEntities(m[1]).trim();
    }
    return null;
  };
  const named = (name) => {
    const patterns = [
      new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, "i"),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return decodeHtmlEntities(m[1]).trim();
    }
    return null;
  };

  const titleTag = (() => {
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m ? m[1].replace(/&amp;/g, "&").trim() : null;
  })();

  return {
    title: prop("og:title") || titleTag,
    description: prop("og:description") || named("description"),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: headers(), body: "" };
  }

  const rawUrl = event.queryStringParameters?.url;
  if (!rawUrl) return respond(400, { error: "url required" });

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return respond(400, { error: "invalid url" });
  }

  try {
    if (!(await isPublicHttpUrlAsync(rawUrl))) return respond(400, { error: "URL is not a public http(s) address" });
  } catch {
    return respond(400, { error: "invalid public URL" });
  }

  const { hostname } = parsed;
  const favicon = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  const empty = { url: rawUrl, hostname, favicon, title: null, description: null };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetchPublicUrl(rawUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "DatIQ/2.0 Preview (+https://datiq.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);

    if (!res.ok || !res.body) return respond(200, empty);

    // Read only the first HEAD_BYTES to keep latency low.
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    reader.cancel().catch(() => {});

    const html = Buffer.concat(chunks).toString("utf8");
    const { title, description } = parseOg(html);

    return respond(200, { url: rawUrl, hostname, favicon, title, description });
  } catch {
    return respond(200, empty);
  }
};
