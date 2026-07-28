// healthProbes.js — the actual reachability checks behind /admin/health.
//
// Each probe returns a RAW observation; classification into ok/degraded/down/
// unknown belongs to src/lib/healthModel.js and happens exactly once, there.
// This file's only job is to ask the question and time the answer:
//
//   { id, configured, reachable, latencyMs, status?, note?, detail? }
//
// FOUR RULES EVERY PROBE FOLLOWS
//
//  1. `configured: false` when the credentials are absent. Never `reachable:
//     false` — "we did not ask" is not "it is down". See healthModel.js.
//  2. Bounded. Every outbound call has an explicit timeout, because a hung
//     vendor endpoint must not hold the dashboard open until the function is
//     killed. Implemented with AbortController + setTimeout, not
//     AbortSignal.timeout (see CLAUDE.md's critical-bugs list).
//  3. Read-only and free. No probe writes anything, and none spends money — the
//     AI and scrape checks report key presence rather than burning tokens on
//     every dashboard refresh.
//  4. Never throws. A probe that fails returns an observation saying so.

import {
  HEALTH_STATUS,
  statusPageIndicatorToStatus,
} from "../../../src/lib/healthModel.js";

const DEFAULT_TIMEOUT_MS = 4000;

/** fetch + a hard timeout + a monotonic-ish duration, and it never throws. */
async function timedFetch(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    return { ok: true, res, latencyMs: Date.now() - t0 };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: aborted ? `Timed out after ${timeoutMs}ms` : (err?.message || String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

const env = (k) => process.env[k] || "";

// ── Statuspage-backed probes ─────────────────────────────────────────────────
// Netlify, Supabase and Razorpay all run Atlassian Statuspage, which exposes an
// unauthenticated /api/v2/status.json. A non-200 from a status page tells us
// nothing about the vendor's actual health, only that we could not read their
// page — so that case is `unknown`, not `down`. Reporting "Netlify is down"
// because their status site had a blip is exactly the false alarm that trains
// operators to ignore the dashboard.
async function statusPageProbe(id, url) {
  const { ok, res, latencyMs, error } = await timedFetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!ok) {
    return { id, configured: true, reachable: true, latencyMs,
      status: HEALTH_STATUS.UNKNOWN, note: `Status page unreachable: ${error}` };
  }
  if (!res.ok) {
    return { id, configured: true, reachable: true, latencyMs,
      status: HEALTH_STATUS.UNKNOWN, note: `Status page returned HTTP ${res.status}.` };
  }
  let body = null;
  try { body = await res.json(); } catch { /* handled below */ }
  const indicator = body?.status?.indicator;
  if (!indicator) {
    return { id, configured: true, reachable: true, latencyMs,
      status: HEALTH_STATUS.UNKNOWN, note: "Status page response was not in the expected shape." };
  }
  return {
    id, configured: true, reachable: true, latencyMs,
    status: statusPageIndicatorToStatus(indicator),
    note: body?.status?.description || "",
    detail: { indicator, page: body?.page?.name || "", updatedAt: body?.page?.updated_at || "" },
  };
}

export const probeNetlifyPlatform = () =>
  statusPageProbe("netlify-platform", "https://www.netlifystatus.com/api/v2/status.json");

export const probeSupabasePlatform = () =>
  statusPageProbe("supabase-platform", "https://status.supabase.com/api/v2/status.json");

export const probeRazorpay = () =>
  statusPageProbe("payments-razorpay", "https://status.razorpay.com/api/v2/status.json");

// ── Supabase ─────────────────────────────────────────────────────────────────

/**
 * Real PostgREST round trip.
 *
 * Deliberately queries `app_config` rather than hitting the API root: the root
 * answers from the gateway and stays green while the database behind it is
 * unreachable. This asks a question only Postgres can answer, over exactly the
 * path the app uses. HEAD + limit=1 keeps it to one row and no payload.
 */
export async function probeSupabaseDb() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_KEY");
  if (!url || !key) return { id: "supabase-db", configured: false };

  const { ok, res, latencyMs, error } = await timedFetch(
    `${url}/rest/v1/app_config?select=key&limit=1`,
    { method: "HEAD", headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!ok) return { id: "supabase-db", configured: true, reachable: false, latencyMs, note: error };
  if (!res.ok) {
    return { id: "supabase-db", configured: true, reachable: true, latencyMs,
      status: HEALTH_STATUS.DOWN, note: `PostgREST returned HTTP ${res.status}.` };
  }
  return { id: "supabase-db", configured: true, reachable: true, latencyMs,
    detail: { endpoint: "rest/v1", probe: "HEAD app_config" } };
}

/** GoTrue's health endpoint. Sign-in usually breaks before the database does. */
export async function probeSupabaseAuth() {
  const url = env("SUPABASE_URL");
  const anon = env("SUPABASE_ANON_KEY") || env("VITE_SUPABASE_ANON_KEY") || env("SUPABASE_SERVICE_KEY");
  if (!url) return { id: "supabase-auth", configured: false };

  const { ok, res, latencyMs, error } = await timedFetch(
    `${url}/auth/v1/health`,
    { headers: anon ? { apikey: anon } : {} },
  );
  if (!ok) return { id: "supabase-auth", configured: true, reachable: false, latencyMs, note: error };
  if (!res.ok) {
    return { id: "supabase-auth", configured: true, reachable: true, latencyMs,
      status: HEALTH_STATUS.DOWN, note: `GoTrue returned HTTP ${res.status}.` };
  }
  let body = null;
  try { body = await res.json(); } catch { /* the 200 is the signal */ }
  return { id: "supabase-auth", configured: true, reachable: true, latencyMs,
    detail: { name: body?.name || "GoTrue", version: body?.version || "" } };
}

// ── Netlify site ─────────────────────────────────────────────────────────────

/**
 * The deployed site itself, via Netlify's API: is the published deploy current,
 * which branch is it from, and how old is it?
 *
 * Needs NETLIFY_AUTH_TOKEN and a site id. Without them this is `unknown` — the
 * common case in local dev and in every test, and it must not read as an outage.
 */
export async function probeNetlifySite() {
  const token = env("NETLIFY_AUTH_TOKEN");
  const siteId = env("NETLIFY_SITE_ID") || env("SITE_ID");
  if (!token || !siteId) return { id: "netlify-site", configured: false };

  const { ok, res, latencyMs, error } = await timedFetch(
    `https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!ok) return { id: "netlify-site", configured: true, reachable: false, latencyMs, note: error };
  if (!res.ok) {
    // 401 is a bad token, not a site outage. Saying "down" would send an
    // operator to look at a site that is serving traffic perfectly well.
    const note = res.status === 401 || res.status === 403
      ? "NETLIFY_AUTH_TOKEN was rejected — the site itself was not checked."
      : `Netlify API returned HTTP ${res.status}.`;
    return { id: "netlify-site", configured: true, reachable: true, latencyMs,
      status: res.status === 401 || res.status === 403 ? HEALTH_STATUS.UNKNOWN : HEALTH_STATUS.DOWN,
      note };
  }
  let site = null;
  try { site = await res.json(); } catch { /* below */ }
  const deploy = site?.published_deploy || {};
  const state = deploy.state || site?.state || "";
  return {
    id: "netlify-site", configured: true, reachable: true, latencyMs,
    // "ready"/"current" are the healthy publish states; anything else means the
    // published deploy is not serving what we think it is.
    status: state && !["ready", "current"].includes(state) ? HEALTH_STATUS.DEGRADED : undefined,
    note: state && !["ready", "current"].includes(state) ? `Published deploy state is "${state}".` : "",
    detail: {
      name: site?.name || "",
      url: site?.ssl_url || site?.url || "",
      state,
      branch: deploy.branch || "",
      deployId: deploy.id || "",
      publishedAt: deploy.published_at || deploy.created_at || "",
    },
  };
}

// ── The runtime we are already inside ────────────────────────────────────────

/**
 * Not a network call — this function is executing, so the runtime is up. It
 * reports WHICH runtime, which is the part an operator actually needs: a
 * dashboard showing production numbers while served from a deploy preview is a
 * trap, and CONTEXT is what reveals it.
 */
export function probeFunctionsRuntime() {
  return {
    id: "functions-runtime",
    configured: true,
    reachable: true,
    latencyMs: 0,
    detail: {
      context: env("CONTEXT") || "unknown",
      site: env("SITE_NAME") || "",
      branch: env("BRANCH") || "",
      deployId: env("DEPLOY_ID") || "",
      region: env("AWS_REGION") || "",
      node: typeof process !== "undefined" ? process.version : "",
    },
  };
}

// ── Third-party services ─────────────────────────────────────────────────────

/**
 * Resend. GET /domains is the cheapest authenticated read that proves both
 * reachability and that the key still works — a revoked key is an outage for
 * invoices and dunning mail, and nothing else would notice until a send failed.
 */
export async function probeResend() {
  const key = env("RESEND_API_KEY");
  if (!key) return { id: "email-resend", configured: false };

  const { ok, res, latencyMs, error } = await timedFetch(
    "https://api.resend.com/domains",
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (!ok) return { id: "email-resend", configured: true, reachable: false, latencyMs, note: error };
  if (res.status === 401 || res.status === 403) {
    return { id: "email-resend", configured: true, reachable: true, latencyMs,
      status: HEALTH_STATUS.DOWN, note: "RESEND_API_KEY was rejected — no mail can be sent." };
  }
  if (!res.ok) {
    return { id: "email-resend", configured: true, reachable: true, latencyMs,
      status: HEALTH_STATUS.DEGRADED, note: `Resend returned HTTP ${res.status}.` };
  }
  let body = null;
  try { body = await res.json(); } catch { /* the 200 is the signal */ }
  const domains = Array.isArray(body?.data) ? body.data : [];
  const verified = domains.filter((d) => d.status === "verified").map((d) => d.name);
  return {
    id: "email-resend", configured: true, reachable: true, latencyMs,
    // Mail from an unverified domain is silently dropped by inbox providers.
    status: domains.length && !verified.length ? HEALTH_STATUS.DEGRADED : undefined,
    note: domains.length && !verified.length ? "No verified sending domain." : "",
    detail: { domains: domains.length, verified: verified.join(", ") },
  };
}

// Key presence only. Probing these means paying for a token or a page fetch on
// every dashboard refresh, and neither answers a question worth that price:
// both are FALLBACK CHAINS, so what matters is how many links are configured.
function chainProbe(id, links) {
  const present = links.filter((l) => l.present);
  const detail = {
    configured: present.map((l) => l.name).join(", ") || "none",
    // Named so the UI can say WHICH provider answers first.
    primary: present[0]?.name || "",
  };
  if (!present.length) {
    return { id, configured: false, detail,
      note: `No provider key set (${links.map((l) => l.name).join(" → ")}).` };
  }
  const alwaysOn = links.some((l) => l.present && l.keyless);
  return {
    id, configured: true, reachable: true, latencyMs: null,
    status: present.length === 1 && !alwaysOn ? HEALTH_STATUS.DEGRADED : HEALTH_STATUS.OK,
    note: present.length === 1 && !alwaysOn
      ? "Only one provider is configured — the fallback chain has no fallback."
      : "",
    detail,
  };
}

export function probeAiProviders() {
  return chainProbe("ai-providers", [
    { name: "Gemini", present: !!env("GEMINI_API_KEY") },
    { name: "Claude", present: !!env("AI_API_KEY") },
    { name: "OpenAI", present: !!env("OPENAI_API_KEY") },
  ]);
}

export function probeScrapeProviders() {
  return chainProbe("scrape-providers", [
    { name: "Firecrawl", present: !!(env("FIRECRAWL_API_KEY") || env("VITE_FIRECRAWL_API_KEY")) },
    { name: "Spider", present: !!env("SPIDER_API_KEY") },
    { name: "Jina", present: !!env("JINA_API_KEY") },
    // Direct fetch needs no key and is always in the chain, which is why
    // extraction degrades rather than stops when every paid provider is absent.
    { name: "Direct fetch", present: true, keyless: true },
  ]);
}

// ── Runner ───────────────────────────────────────────────────────────────────

// Each entry carries its own id rather than deriving one from the function
// name: a probe that REJECTS still has to produce an observation, and that
// observation has to be attributable to the right component. Deriving
// "netlifysite" from `probeNetlifySite.name` would silently orphan the row.
const PROBES = [
  { id: "netlify-site",       fn: probeNetlifySite },
  { id: "netlify-platform",   fn: probeNetlifyPlatform },
  { id: "functions-runtime",  fn: probeFunctionsRuntime },
  { id: "supabase-db",        fn: probeSupabaseDb },
  { id: "supabase-auth",      fn: probeSupabaseAuth },
  { id: "supabase-platform",  fn: probeSupabasePlatform },
  { id: "email-resend",       fn: probeResend },
  { id: "payments-razorpay",  fn: probeRazorpay },
  { id: "ai-providers",       fn: probeAiProviders },
  { id: "scrape-providers",   fn: probeScrapeProviders },
];

/**
 * Run every probe concurrently and return raw observations.
 *
 * Promise.allSettled, not Promise.all: one probe throwing must not blank the
 * whole dashboard. A rejected probe becomes an `unknown` observation carrying
 * its own error, which is exactly what an operator needs to see.
 */
export async function runAllProbes() {
  const checkedAt = new Date().toISOString();
  const settled = await Promise.allSettled(PROBES.map((p) => p.fn()));
  return settled.map((r, i) => {
    const { id } = PROBES[i];
    if (r.status === "fulfilled" && r.value) return { id, ...r.value, checkedAt };
    return {
      id,
      configured: true,
      status: HEALTH_STATUS.UNKNOWN,
      note: `Probe threw: ${r.reason?.message || r.reason || "unknown error"}`,
      checkedAt,
    };
  });
}

export const _internal = { timedFetch, statusPageProbe, chainProbe, PROBES, DEFAULT_TIMEOUT_MS };
