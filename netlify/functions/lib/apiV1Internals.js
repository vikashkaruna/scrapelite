// netlify/functions/lib/apiV1Internals.js
//
// Internal helpers used by the /api/v1 router. Extracted from api-v1.js so
// they can be mocked in tests (self-mocking doesn't work with ESM).
//
// These wrap calls to the existing /api/extract and /api/ai functions. The
// router invokes them as if it were the browser; the base URL is the
// deployed Netlify site, env-configurable so tests can point at a local
// mock.

export function getInternalBase() {
  return process.env.DATIQ_INTERNAL_API_BASE
    || process.env.URL
    || process.env.SITE_URL
    || "http://localhost:8888";
}

export async function callInternalExtract(url, options, auth) {
  const base = getInternalBase();
  try {
    const res = await fetch(`${base}/.netlify/functions/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key-Id": auth.key.id },
      body: JSON.stringify({ url, options }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || `extract_${res.status}` };
    return { ok: true, data: data.data || {} };
  } catch (err) {
    return { ok: false, error: err?.message || "network" };
  }
}

export async function callInternalAi(payload, auth) {
  const base = getInternalBase();
  try {
    const res = await fetch(`${base}/.netlify/functions/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key-Id": auth.key.id },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || `ai_${res.status}` };
    const content = data?.content?.[0]?.text
      || data?.content
      || data?.text
      || (typeof data === "string" ? data : null);
    return { ok: true, content: content || "" };
  } catch (err) {
    return { ok: false, error: err?.message || "network" };
  }
}
