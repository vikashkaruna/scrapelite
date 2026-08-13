// netlify/functions/lib/supabaseServerClient.js
//
// The ONE place server-side code builds a Supabase client and authenticates a
// bearer token. Two independent production outages came from this logic being
// copy-pasted into eight files, so it lives here now and every function
// imports it.
//
// ── 1. Realtime / WebSocket ─────────────────────────────────────────────────
// @supabase/supabase-js >=2.108 eagerly constructs a RealtimeClient inside
// createClient() (SupabaseClient constructor -> _initRealtimeClient ->
// new RealtimeClient() -> _initializeOptions()), which resolves
// `options.transport ?? WebSocketFactory.getWebSocketConstructor()`
// SYNCHRONOUSLY at construction time — not lazily on first `.channel()`
// call. Netlify Functions run on Node 20, which has no native global
// WebSocket, so `getWebSocketConstructor()` THROWS:
//   "Node.js 20 detected without native WebSocket support. ..."
// None of these server-side functions use Realtime (.channel()/.subscribe()
// are never called — they only use auth.getUser() and REST queries), so the
// fix is to hand createClient() a harmless placeholder transport. This
// short-circuits the `??` fallback and skips getWebSocketConstructor()
// entirely, without adding a "ws" dependency neither Node runtime needs.
// See docs/SESSION-HANDOFF-2026-08-13-REALTIME-WEBSOCKET-FIX.md.
//
// ── 2. The anon key ─────────────────────────────────────────────────────────
// Every call site used to read:
//     process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
// which has two defects that together produced the "Invalid or expired
// session (Invalid API key)" outage on every integration connect:
//
//   (a) PRECEDENCE. A `SUPABASE_ANON_KEY` that is set but WRONG (stale, from
//       another project, or redacted) wins over a perfectly healthy
//       `VITE_SUPABASE_ANON_KEY`. resolveSupabaseEnv() instead picks the
//       first candidate that is present AND structurally usable.
//
//   (b) REDACTION. Netlify's secret scanner rewrites JWT-shaped env values to
//       `****************<last4>`. The browser has been defended against this
//       since the OAuth outage (see looksStrippedByNetlify in
//       src/lib/config.js — keep the two predicates in sync), but the
//       functions were not, so they silently handed GoTrue a row of asterisks
//       and GoTrue answered "Invalid API key". Which the caller then reported
//       to the user as "Invalid or expired session" — blaming their login for
//       a server misconfiguration.
//
// The asymmetry that matters: a bad key is an OPERATOR problem, so it must
// surface as 503 naming the variable, never as 401 blaming the user.
import { createClient } from "@supabase/supabase-js";

class NoRealtimeTransport {}

/**
 * Merge caller-supplied supabase-js client options with the realtime
 * transport stub. Caller's own `realtime` sub-options (if any) are
 * preserved; only `transport` is forced.
 */
export function noRealtimeOptions(options = {}) {
  return {
    ...options,
    realtime: { ...options.realtime, transport: NoRealtimeTransport },
  };
}

/**
 * Detect Netlify's secret-scanner redaction fingerprint: 16+ asterisks
 * followed by a short tail. Purely structural — no real key can match, since
 * anon keys start with `eyJ` (base64 of `{"alg"…`) and URLs with `http`.
 *
 * TWIN: src/lib/config.js `looksStrippedByNetlify`. That copy guards the
 * browser bundle and cannot be imported here (config.js reads
 * `import.meta.env`, which is not available under Node). Change both together.
 */
export function looksStrippedByNetlify(value) {
  if (typeof value !== "string") return false;
  return /^\*{16,}[A-Za-z0-9]{2,6}$/.test(value);
}

/**
 * A non-secret fingerprint for diagnostics: enough to tell two projects'
 * keys apart at a glance, never enough to use one. Redacted values are
 * called out explicitly because that is the failure we are hunting.
 */
export function maskKey(value) {
  if (typeof value !== "string" || !value) return "(unset)";
  if (looksStrippedByNetlify(value)) return `(redacted by Netlify's secret scanner, ${value.length} chars)`;
  if (value.length <= 8) return `(suspiciously short, ${value.length} chars)`;
  return `${value.slice(0, 3)}…${value.slice(-4)} (${value.length} chars)`;
}

const URL_CANDIDATES = ["SUPABASE_URL", "VITE_SUPABASE_URL"];
const ANON_KEY_CANDIDATES = ["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"];

/**
 * Pick the first env var that is set AND not redacted.
 * @returns {{name: string|null, value: string|null, presentButUnusable: string[]}}
 */
function pickUsable(names, env) {
  const presentButUnusable = [];
  for (const name of names) {
    const raw = typeof env[name] === "string" ? env[name].trim() : "";
    if (!raw) continue;
    if (looksStrippedByNetlify(raw)) {
      presentButUnusable.push(name);
      continue;
    }
    return { name, value: raw, presentButUnusable };
  }
  return { name: null, value: null, presentButUnusable };
}

/**
 * Resolve the Supabase URL + anon key this runtime should use.
 *
 * @returns {{
 *   url: string|null, anonKey: string|null,
 *   urlSource: string|null, keySource: string|null,
 *   problem: null|"missing_url"|"missing_key"|"key_stripped"|"url_stripped",
 *   message: string|null
 * }}
 * `problem` non-null means the caller must fail with 503, not 401.
 */
export function resolveSupabaseEnv(env = process.env) {
  const url = pickUsable(URL_CANDIDATES, env);
  const key = pickUsable(ANON_KEY_CANDIDATES, env);

  const base = {
    url: url.value,
    anonKey: key.value,
    urlSource: url.name,
    keySource: key.name,
  };

  if (!url.value) {
    return {
      ...base,
      problem: url.presentButUnusable.length ? "url_stripped" : "missing_url",
      message: url.presentButUnusable.length
        ? `Supabase is misconfigured on this server: ${url.presentButUnusable.join(" and ")} was redacted by Netlify's secret scanner. Add it to SECRETS_SCAN_OMIT_KEYS in netlify.toml.`
        : "Supabase is misconfigured on this server: set SUPABASE_URL.",
    };
  }
  if (!key.value) {
    return {
      ...base,
      problem: key.presentButUnusable.length ? "key_stripped" : "missing_key",
      message: key.presentButUnusable.length
        ? `Supabase is misconfigured on this server: ${key.presentButUnusable.join(" and ")} was redacted by Netlify's secret scanner. Add it to SECRETS_SCAN_OMIT_KEYS in netlify.toml.`
        : "Supabase is misconfigured on this server: set SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY).",
    };
  }
  return { ...base, problem: null, message: null };
}

/**
 * GoTrue's reply when the `apikey` header is not valid for the project at
 * SUPABASE_URL. This is NOT a bad user session — it means the deployed anon
 * key and the deployed project URL disagree, so the caller must answer 503.
 */
export function isInvalidApiKeyError(error) {
  const msg = String(error?.message || error || "");
  return /invalid api key/i.test(msg);
}

/** Operator-facing text for a key/URL mismatch, naming what to check. */
export function invalidApiKeyMessage(env = process.env) {
  const { urlSource, keySource, anonKey } = resolveSupabaseEnv(env);
  return (
    "Supabase rejected this server's API key. The anon key and the project URL " +
    `do not match — check ${keySource || "SUPABASE_ANON_KEY"} against ` +
    `${urlSource || "SUPABASE_URL"} in the Netlify environment for this context ` +
    `(key in use: ${maskKey(anonKey)}).`
  );
}

/**
 * Build an anon-key client that carries the caller's JWT.
 * @returns {{client: object|null, problem: string|null, message: string|null}}
 */
export function getUserScopedClient(authHeader) {
  const resolved = resolveSupabaseEnv();
  if (resolved.problem) {
    return { client: null, problem: resolved.problem, message: resolved.message };
  }
  const client = createClient(resolved.url, resolved.anonKey, noRealtimeOptions({
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
    auth: { persistSession: false },
  }));
  return { client, problem: null, message: null };
}

/** Pull the raw JWT out of an `Authorization: Bearer <jwt>` header. */
export function bearerToken(authHeader) {
  return /^Bearer\s+(.+)$/i.exec(String(authHeader || ""))?.[1]?.trim() || "";
}

/**
 * Authenticate a request's bearer token — the single implementation shared by
 * every function that used to hand-roll this.
 *
 * Returns a status + plain body rather than an HTTP response, because each
 * function owns its own CORS headers and `respond()` helper.
 *
 * @returns {Promise<
 *   {ok: true, user: object, client: object} |
 *   {ok: false, status: number, body: {error: string, reason?: string}}
 * >}
 */
export async function authenticateBearer(event, { label = "supabase" } = {}) {
  const authHeader = event?.headers?.authorization || event?.headers?.Authorization || "";
  if (!authHeader) {
    return { ok: false, status: 401, body: { error: "Authentication required" } };
  }
  // supabase-js v2.108+ returns AuthSessionMissingError when `getUser()` is
  // called with no argument on a client that has no stored session and no
  // `hasCustomAuthorizationHeader: true` flag — even though the global
  // Authorization header IS set. Passing the JWT explicitly is the documented
  // server-side pattern and bypasses that check. (fix 2026-08-12)
  const jwt = bearerToken(authHeader);
  if (!jwt) {
    return { ok: false, status: 401, body: { error: "Authentication required" } };
  }

  const { client, problem, message } = getUserScopedClient(authHeader);
  if (!client) {
    console.error(`[${label}] Supabase env problem: ${problem} — ${message}`);
    return { ok: false, status: 503, body: { error: message, reason: problem } };
  }

  let user = null;
  let error = null;
  try {
    const res = await client.auth.getUser(jwt);
    user = res?.data?.user ?? null;
    error = res?.error ?? null;
  } catch (err) {
    error = err;
  }

  if (error || !user) {
    // "Invalid API key" is a DEPLOYMENT fault, not a session fault. Reporting
    // it as 401 is what made this outage look like an auth bug for three
    // sessions running — the user's token was fine every time.
    if (isInvalidApiKeyError(error)) {
      const msg = invalidApiKeyMessage();
      console.error(`[${label}] ${msg}`);
      return { ok: false, status: 503, body: { error: msg, reason: "invalid_api_key" } };
    }
    console.warn(
      `[${label}] getUser(jwt) rejected:`,
      error?.message || "no user returned",
      error?.status ?? "",
    );
    return {
      ok: false,
      status: 401,
      body: { error: "Invalid or expired session", reason: error?.message || "no_user" },
    };
  }

  return { ok: true, user, client };
}

export const _internal = { NoRealtimeTransport, pickUsable };
