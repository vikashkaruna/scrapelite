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
// A LIVE ping, not a key-presence check — see the note above probeAiProviders.
import { pingProvider, PROVIDER_ERROR_COPY } from "./aiProviders.js";
import { PROVIDERS, AI_PROVIDERS, readKey } from "../../../src/lib/providerRegistry.js";
// Same resolution order the functions use, so the probe reports on the key the
// app actually authenticates with rather than a healthier one nearby.
import {
  resolveSupabaseEnv,
  maskKey,
  diagnoseSupabaseIdentity,
  decodeSupabaseKey,
} from "./supabaseServerClient.js";

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

/**
 * Razorpay Payment Gateway probe.
 *
 * Checks Razorpay API reachability and key validity.
 * If RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set, makes an authenticated probe
 * to GET https://api.razorpay.com/v1/payments?count=1.
 * If keys are not set, probes the API gateway to confirm Razorpay is live and reachable.
 */
export async function probeRazorpay() {
  const keyId = env("RAZORPAY_KEY_ID");
  const keySecret = env("RAZORPAY_KEY_SECRET");

  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DatIQ-HealthMonitor/1.0",
    Accept: "application/json",
  };

  if (keyId && keySecret) {
    const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
    headers.Authorization = authHeader;

    const { ok, res, latencyMs, error } = await timedFetch(
      "https://api.razorpay.com/v1/payments?count=1",
      { headers },
    );

    if (!ok) {
      return {
        id: "payments-razorpay",
        configured: true,
        reachable: false,
        latencyMs,
        status: HEALTH_STATUS.UNKNOWN,
        note: `Razorpay API unreachable: ${error}`,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        id: "payments-razorpay",
        configured: true,
        reachable: true,
        latencyMs,
        status: HEALTH_STATUS.DOWN,
        note: "RAZORPAY_KEY_ID / KEY_SECRET rejected by Razorpay.",
        detail: { keyId: maskKey(keyId) },
      };
    }

    if (!res.ok) {
      return {
        id: "payments-razorpay",
        configured: true,
        reachable: true,
        latencyMs,
        status: HEALTH_STATUS.DEGRADED,
        note: `Razorpay API returned HTTP ${res.status}.`,
      };
    }

    return {
      id: "payments-razorpay",
      configured: true,
      reachable: true,
      latencyMs,
      status: HEALTH_STATUS.OK,
      note: "Razorpay API is live and credentials are valid.",
      detail: { keyId: maskKey(keyId), endpoint: "api.razorpay.com/v1" },
    };
  }

  // No API keys configured on server: probe API gateway liveness
  const { ok, res, latencyMs, error } = await timedFetch(
    "https://api.razorpay.com/v1/payments",
    { headers },
  );

  if (!ok) {
    return {
      id: "payments-razorpay",
      configured: false,
      reachable: false,
      latencyMs,
      status: HEALTH_STATUS.UNKNOWN,
      note: `Razorpay gateway unreachable: ${error}`,
    };
  }

  // A 400 or 401 from /v1/payments asking for API credentials proves the gateway is reachable and answering
  if (res.status === 400 || res.status === 401) {
    return {
      id: "payments-razorpay",
      configured: false,
      reachable: true,
      latencyMs,
      status: HEALTH_STATUS.OK,
      note: "Razorpay API gateway is reachable (keys not configured on server).",
      detail: { endpoint: "api.razorpay.com/v1" },
    };
  }

  return {
    id: "payments-razorpay",
    configured: false,
    reachable: true,
    latencyMs,
    status: res.ok ? HEALTH_STATUS.OK : HEALTH_STATUS.DEGRADED,
    note: `Razorpay API returned HTTP ${res.status}.`,
  };
}

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

/**
 * GoTrue reachability AND anon-key validity. Sign-in usually breaks before the
 * database does — and the key breaks before either.
 *
 * `/auth/v1/health` alone is NOT enough, and trusting it cost us an outage:
 * that endpoint is UNAUTHENTICATED, so it answers 200 with a completely
 * invalid `apikey`. This card stayed green for days while every
 * `auth.getUser()` in the product failed with "Invalid API key" and users were
 * told their session had expired. So we do two round trips: liveness, then a
 * real authenticated call that can only succeed if the deployed key actually
 * belongs to the project at SUPABASE_URL.
 *
 * The key check uses the SAME resolution order as the functions
 * (resolveSupabaseEnv), so this probe reports on the key the app actually
 * uses — not a different one that happens to be healthy. It deliberately does
 * NOT fall back to the service key: that would mask exactly the failure we are
 * looking for.
 */
export async function probeSupabaseAuth() {
  const url = env("SUPABASE_URL");
  if (!url) return { id: "supabase-auth", configured: false };

  const resolved = resolveSupabaseEnv(process.env);

  // A REDACTED key is a fault we can report without any network call: the
  // variable is set, its value is corrupted, and we can name it. Rule 1 of
  // this file does not apply — this is not "we did not ask", it is a
  // configured value that is provably unusable.
  if (resolved.problem === "key_stripped") {
    return {
      id: "supabase-auth", configured: true, reachable: true, latencyMs: 0,
      status: HEALTH_STATUS.DOWN,
      note: resolved.message,
      detail: { anonKey: maskKey(resolved.anonKey), keySource: resolved.keySource || "(none)" },
    };
  }

  // The key names its own project, so a mismatch is provable with NO network
  // call — and it is strictly more useful than anything the network can tell
  // us, because Supabase only ever answers "Invalid API key" without saying
  // which side is wrong. Run it FIRST. A `custom_domain` finding is context
  // rather than a verdict, so it does not short-circuit the live checks.
  const identity = diagnoseSupabaseIdentity(process.env);
  if (identity.problem && identity.problem !== "custom_domain") {
    return {
      id: "supabase-auth", configured: true, reachable: true, latencyMs: 0,
      status: HEALTH_STATUS.DOWN,
      note: identity.message,
      detail: { ...identity.detail, anonKey: maskKey(resolved.anonKey) },
    };
  }

  const { ok, res, latencyMs, error } = await timedFetch(
    `${url}/auth/v1/health`,
    { headers: resolved.anonKey ? { apikey: resolved.anonKey } : {} },
  );
  if (!ok) return { id: "supabase-auth", configured: true, reachable: false, latencyMs, note: error };
  if (!res.ok) {
    // A 401 here is the gateway rejecting the apikey, NOT GoTrue being down.
    // Reporting it as "GoTrue returned HTTP 401" is what made production's
    // card strictly less useful than staging's while both had key faults —
    // so attach whatever the offline diagnosis knows.
    const isAuthReject = res.status === 401 || res.status === 403;
    return {
      id: "supabase-auth", configured: true, reachable: true, latencyMs,
      status: HEALTH_STATUS.DOWN,
      note: isAuthReject
        ? `Supabase's gateway rejected this server's anon key (HTTP ${res.status}) — ` +
          "GoTrue itself is not necessarily down. " +
          (identity.message ||
            `Check ${resolved.keySource} against SUPABASE_URL for this context.`)
        : `GoTrue returned HTTP ${res.status}.`,
      detail: { ...identity.detail, anonKey: maskKey(resolved.anonKey) },
    };
  }
  let body = null;
  try { body = await res.json(); } catch { /* the 200 is the signal */ }

  // No anon key at all → we cannot check validity, and rule 1 says "we did not
  // ask" is never "it is down". Report liveness and say the key was unchecked;
  // inventing an outage here is exactly what gets a dashboard muted.
  if (!resolved.anonKey) {
    return {
      id: "supabase-auth", configured: true, reachable: true, latencyMs,
      note: "GoTrue is live. Anon key not configured, so key validity was not checked.",
      detail: { name: body?.name || "GoTrue", version: body?.version || "", anonKey: "(unset)" },
    };
  }

  // Now the part /auth/v1/health cannot tell us: is this key actually valid
  // for this project?
  //
  // ⚠️ NOT `/rest/v1/`. That was the first choice here and it was wrong:
  // Supabase removed anon-key access to the PostgREST OpenAPI root (11 Mar
  // 2026 for new projects, 8 Apr 2026 for all), so it now refuses EVERY anon
  // key by design with "Secret API key required" / "Access to schema is
  // forbidden". The probe read that refusal as proof the key was wrong and
  // reported a healthy staging environment as broken.
  //
  // `/auth/v1/settings` is the right question: it requires an apikey, accepts
  // an anon/publishable one, and lives in the service this component is about.
  const KEY_CHECK_PATH = "/auth/v1/settings";
  const keyCheck = await timedFetch(`${url}${KEY_CHECK_PATH}`, {
    headers: { apikey: resolved.anonKey },
  });
  const detail = {
    name: body?.name || "GoTrue",
    version: body?.version || "",
    anonKey: maskKey(resolved.anonKey),
    // Legacy `eyJ…` keys are deprecated end-2026. Context only — never a status.
    keyFormat: decodeSupabaseKey(resolved.anonKey).format,
    keyCheck: KEY_CHECK_PATH,
    ...identity.detail,
  };
  if (!keyCheck.ok) {
    // The key round trip itself failed to complete. Liveness passed, so report
    // the component as up but say the key could not be verified — an
    // unverified key is not a proven-bad key.
    return { id: "supabase-auth", configured: true, reachable: true, latencyMs,
      note: `Anon key not verified: ${keyCheck.error}.`, detail };
  }
  if (keyCheck.res.status === 401 || keyCheck.res.status === 403) {
    let why = "";
    try {
      const j = await keyCheck.res.json();
      why = j?.message || j?.msg || j?.error_description || j?.error || "";
    } catch { /* status is the signal */ }

    // Classify the refusal. "This key is invalid" and "this endpoint needs a
    // more privileged key" are completely different findings, and collapsing
    // them is exactly the bug above — a privilege requirement was reported as
    // a project mismatch, turning a green environment red.
    if (/invalid\s+api\s+key|no\s+api\s+key/i.test(why)) {
      return {
        id: "supabase-auth", configured: true, reachable: true, latencyMs,
        status: HEALTH_STATUS.DOWN,
        note:
          `Supabase rejected this server's anon key ("${why}"). ` +
          // When the URL is a custom domain we could not compare refs offline,
          // so say so — that IS the likely cause, and it is a different fix
          // from "wrong key".
          (identity.message ||
            `${resolved.keySource} does not belong to the project at SUPABASE_URL — ` +
              "every signed-in request will fail with \"Invalid or expired session\". " +
              "Fix the value in the Netlify environment for this context."),
        detail: { ...detail, rejection: why },
      };
    }

    // Anything else — "Secret API key required", "Access to schema is
    // forbidden", or a message we have never seen — means we could not answer
    // the question, NOT that the key is bad. Rule 1 of this file: "we did not
    // ask" is never "it is down". Inventing an outage here is what got this
    // dashboard disbelieved.
    return {
      id: "supabase-auth", configured: true, reachable: true, latencyMs,
      note:
        `Anon key could not be verified: ${KEY_CHECK_PATH} answered HTTP ` +
        `${keyCheck.res.status}${why ? ` ("${why}")` : ""}, which is a privilege ` +
        "requirement rather than a rejected key. GoTrue is live and the offline " +
        "project-ref check passed; treat the key as unverified, not as wrong.",
      detail: { ...detail, rejection: why || `HTTP ${keyCheck.res.status}` },
    };
  }
  return { id: "supabase-auth", configured: true, reachable: true, latencyMs,
    detail: { ...detail, anonKeyValid: true } };
}

/**
 * Pulls the human-readable project name for the AdminHealth "Data & identity"
 * header. Resolution order:
 *   1. SUPABASE_PROJECT_NAME env var (set this in Netlify to display the
 *      operator-chosen label, e.g. "DatIQ production").
 *   2. A masked form of the project reference parsed from SUPABASE_URL — the
 *      first 4 + last 2 characters of the subdomain, so two projects on the
 *      same Supabase org can be told apart at a glance but the full ref is
 *      never shown.
 *
 * Never throws. Always returns a string (or null if no URL is configured).
 */
export function supabaseDisplayName() {
  const override = env("SUPABASE_PROJECT_NAME");
  if (override) return override;
  const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL") || "";
  if (!url) return null;
  try {
    const host = new URL(url).hostname || "";
    const sub = host.split(".")[0] || "";
    if (!sub) return null;
    if (sub.length <= 8) return `project · ${sub}`;
    return `project · ${sub.slice(0, 4)}…${sub.slice(-2)}`;
  } catch {
    return null;
  }
}

// ── Netlify site ─────────────────────────────────────────────────────────────

/**
 * The deployed site itself, as seen from INSIDE the running function.
 *
 * Every Netlify Function automatically gets a set of build-context env vars
 * (CONTEXT, BRANCH, DEPLOY_ID, SITE_NAME, DEPLOY_PRIME_URL, …) — see
 * https://docs.netlify.com/build/configure-builds/environment-variables/#build-time-environment-variables
 * These are exactly the values an operator wants to see on /admin/health: which
 * site is serving this response, from which branch, in which context.
 *
 * We no longer call the Netlify API for this. The earlier design used
 * NETLIFY_AUTH_TOKEN + an API call to read published_deploy state, but that
 * required an operator to create and paste a PAT, and the most common failure
 * was simply that no token was set — so the dashboard painted a critical
 * component as "not checked" forever. Reading the env the runtime already
 * exposes gives the same answer with zero configuration and zero credentials.
 */
export function probeNetlifySite() {
  // DEPLOY_PRIME_URL is the URL the function was invoked from. SITE_NAME is the
  // project handle (e.g. "datiqapp"). Both are auto-injected on every deploy.
  const context   = env("CONTEXT") || "";
  const branch    = env("BRANCH")  || "";
  const deployId  = env("DEPLOY_ID") || "";
  const siteName  = env("SITE_NAME") || "";
  const url       = env("DEPLOY_PRIME_URL") || env("URL") || "";

  // These are the contexts Netlify publishes. Anything else (custom, unknown)
  // is still "configured" — the function IS running — but the operator should
  // see which context they are in.
  const known = ["production", "branch-deploy", "deploy-preview", "dev"];
  const status = context && !known.includes(context) ? HEALTH_STATUS.DEGRADED : undefined;

  return {
    id: "netlify-site",
    configured: true,
    reachable: true,
    latencyMs: 0,
    status,
    note: status ? `Unknown Netlify CONTEXT: "${context}".` : "",
    detail: {
      site: siteName,
      url,
      context,
      branch,
      deployId,
      // A short label the AdminHealth header can use to say "you are looking
      // at the main deploy" / "a branch deploy" without printing the full URL.
      envLabel: contextToLabel(context, branch),
    },
  };
}

function contextToLabel(context, branch) {
  if (context === "production") return "production";
  if (context === "branch-deploy") return branch ? `branch · ${branch}` : "branch deploy";
  if (context === "deploy-preview") return branch ? `preview · ${branch}` : "deploy preview";
  if (context === "dev") return "local dev";
  if (branch) return `${context || "deploy"} · ${branch}`;
  return context || "unknown";
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
    // Resend has two key permission levels: "Full access" and "Sending
    // access" (the least-privilege choice for a key that only ever needs to
    // send mail — exactly what this app uses it for). A sending-access key
    // is CORRECTLY rejected from GET /domains, a Full-access-only endpoint,
    // and Resend names that specific case in the response body
    // (`name: "restricted_api_key"`) so it can be told apart from a key
    // that is actually invalid or revoked. Reporting the former as "down —
    // no mail can be sent" is a false positive: the key still sends mail
    // fine, it just can't be used to read domain-verification status from
    // here. Any other 401/403 (bad body, wrong `name`, or none at all —
    // the ordinary shape of an invalid key) is a genuine rejection.
    let body = null;
    try { body = await res.json(); } catch { /* falls through to "rejected" below */ }
    if (body?.name === "restricted_api_key") {
      return { id: "email-resend", configured: true, reachable: true, latencyMs,
        note: "API key is scoped to sending access — domain verification status can't be checked from health, but mail can still send.",
        detail: { scope: "sending_access" } };
    }
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

// ── Provider chains ──────────────────────────────────────────────────────────
//
// ⚠️ THIS USED TO BE KEY-PRESENCE ONLY, AND THAT IS HOW A TOTAL AI OUTAGE
// STAYED GREEN FOR WEEKS. The old comment argued that probing "means paying
// for a token on every dashboard refresh, and neither answers a question worth
// that price". That reasoning is exactly inverted for the failure that
// actually happened: key PRESENCE is the one thing that never breaks. All
// three AI keys were present and every one was dead — one invalid, two out of
// credit — while this dashboard reported "operational".
//
// The AI probe now makes a real ~16-token completion per provider, cached for
// PROBE_TTL_MS so a dashboard refresh does not re-bill. A few tokens an hour
// is a rounding error against an outage nobody can see.
//
// The SCRAPE probe stays presence-based, and that asymmetry is deliberate:
// `direct` needs no key and is always in the chain, so scraping degrades
// rather than stops, and a real probe would fetch somebody's website on a
// timer to prove it.

const PROBE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let _aiProbeCache = null;

function presenceDetail(links) {
  const present = links.filter((l) => l.present);
  return {
    configured: present.map((l) => l.name).join(", ") || "none",
    primary: present[0]?.name || "",
  };
}

function chainProbe(id, links) {
  const present = links.filter((l) => l.present);
  const detail = presenceDetail(links);
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

/**
 * LIVE AI chain probe. Pings every AI provider that has a key and reports what
 * the chain can ACTUALLY do right now, not what is configured.
 *
 * Verdict rules:
 *   - no keys at all            → unknown (not checked), never "down"
 *   - every keyed provider dead → DOWN, naming the first actionable cause
 *   - some dead                 → DEGRADED (the chain still answers)
 *   - all alive                 → OK
 */
export async function probeAiProviders({ force = false } = {}) {
  const id = "ai-providers";
  const links = AI_PROVIDERS.map((p) => ({ key: p, name: PROVIDERS[p].label, present: !!readKey(p, process.env) }));
  const detail = presenceDetail(links);
  const keyed = links.filter((l) => l.present);

  if (!keyed.length) {
    return { id, configured: false, detail,
      note: `No provider key set (${links.map((l) => l.name).join(" → ")}).` };
  }

  if (!force && _aiProbeCache && Date.now() - _aiProbeCache.at < PROBE_TTL_MS) {
    return { ..._aiProbeCache.result, detail: { ..._aiProbeCache.result.detail, cached: true } };
  }

  const startedAt = Date.now();
  let pings = [];
  try {
    const raw = await Promise.all(keyed.map((l) => pingProvider(l.key)));
    // Normalise defensively. A probe must NEVER throw — that is rule 4 in this
    // file's header — and a malformed result from one provider adapter must
    // not take the whole health dashboard down with it.
    pings = raw.map((r, i) => (r && typeof r === "object")
      ? { provider: r.provider || keyed[i].key, ...r, ok: r.ok === true }
      : { provider: keyed[i].key, ok: false, code: "error", error: "Probe returned no result." });
  } catch {
    // pingProvider never throws, but a Promise.all that somehow does must not
    // take the whole health dashboard with it.
    return { id, configured: true, reachable: false, status: HEALTH_STATUS.DEGRADED,
      note: "The AI liveness probe could not run.", detail };
  }
  const latencyMs = Date.now() - startedAt;
  const alive = pings.filter((p) => p.ok);
  const dead = pings.filter((p) => !p.ok);

  const perProvider = pings.map((p) => ({
    provider: p.provider,
    label: PROVIDERS[p.provider]?.label || p.provider,
    ok: p.ok, code: p.code, model: p.model, latencyMs: p.latencyMs,
    // The vendor's own message, which is the fastest route to the fix
    // ("credit balance is too low" / "API key not valid").
    error: p.ok ? undefined : String(p.error || "").slice(0, 200),
  }));

  let status, note;
  if (!alive.length) {
    status = HEALTH_STATUS.DOWN;
    const first = dead[0];
    note = `Every configured AI provider is failing. ${PROVIDERS[first.provider]?.label || first.provider}: ${PROVIDER_ERROR_COPY[first.code] || first.error}`;
  } else if (dead.length) {
    status = HEALTH_STATUS.DEGRADED;
    note = `${dead.length} of ${pings.length} AI providers failing (${dead.map((d) => `${PROVIDERS[d.provider]?.label}: ${d.code}`).join("; ")}). The chain still answers via ${PROVIDERS[alive[0].provider]?.label}.`;
  } else {
    status = HEALTH_STATUS.OK;
    note = "";
  }

  const result = {
    id, configured: true, reachable: alive.length > 0, status, note, latencyMs,
    detail: { ...detail, live: true, providers: perProvider },
  };
  _aiProbeCache = { at: Date.now(), result };
  return result;
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
