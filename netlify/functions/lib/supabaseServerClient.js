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
// call. The stub remains defensive: server code does not use Realtime, and
// the regression test intentionally verifies behaviour without a global
// WebSocket even though Node 24 provides one. Historically,
// `getWebSocketConstructor()` THREW:
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

// ── Key/URL identity ────────────────────────────────────────────────────────
//
// A Supabase anon key is a JWT, and its payload names the project it belongs
// to. So "does this key match this URL?" is answerable OFFLINE, for free,
// before any network call — which matters more than it sounds: that question
// went unasked for three debugging sessions while the only feedback anyone had
// was the string "Invalid API key". The ref was sitting in plaintext inside
// the key the whole time.
//
// We decode the payload WITHOUT verifying the signature. That is correct here:
// we are not authenticating anything, we are reading a self-declared project
// id for a diagnostic. Nothing is trusted on the strength of it.

/**
 * Read the claims out of a Supabase key.
 *
 * Handles both formats:
 *   - legacy JWT      `eyJ…` → { format: "jwt", ref, role, exp }
 *   - newer publishable `sb_publishable_…` / `sb_secret_…` → no claims to read
 *
 * Never throws — a malformed key returns format "unknown" so callers can say
 * "could not read" rather than crashing a health probe.
 */
export function decodeSupabaseKey(key) {
  const empty = { format: "unknown", ref: null, role: null, exp: null };
  if (typeof key !== "string" || !key) return { ...empty, format: "missing" };
  // The two new-format keys are NOT interchangeable and must not share a
  // verdict. `sb_publishable_…` is the browser-safe key; `sb_secret_…`
  // bypasses Row Level Security exactly like a service_role JWT does.
  // Collapsing both to "publishable" made the service-key guard below blind
  // to the newer format — and the newer format is what Supabase now issues
  // by default, so the guard was silently unarmed on any recent project.
  if (/^sb_publishable_/.test(key)) {
    return { ...empty, format: "publishable" };
  }
  if (/^sb_secret_/.test(key)) {
    return { ...empty, format: "secret" };
  }
  const parts = key.split(".");
  if (parts.length !== 3) return empty;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return {
      format: "jwt",
      ref: typeof payload.ref === "string" ? payload.ref : null,
      role: typeof payload.role === "string" ? payload.role : null,
      exp: Number.isFinite(payload.exp) ? payload.exp : null,
    };
  } catch {
    return empty;
  }
}

/**
 * The project ref for a Supabase URL — the first host label of a
 * `<ref>.supabase.co` address.
 *
 * Returns null for anything else, which is NOT an error: a full custom domain
 * is legitimate. It just means the ref cannot be compared, so the caller must
 * not claim a mismatch it cannot actually see.
 */
export function projectRefFromUrl(url) {
  try {
    const host = new URL(String(url)).hostname;
    if (!/\.supabase\.(co|in|red)$/.test(host)) return null;
    return host.split(".")[0] || null;
  } catch {
    return null;
  }
}

/**
 * Compare the deployed key against the deployed URL and name what is wrong.
 * Pure and offline.
 *
 * @returns {{problem: string|null, message: string|null, detail: object}}
 */
export function diagnoseSupabaseIdentity(env = process.env) {
  const resolved = resolveSupabaseEnv(env);
  const claims = decodeSupabaseKey(resolved.anonKey);
  const urlRef = projectRefFromUrl(resolved.url);
  const detail = {
    // The URL is not a secret, and printing it (plus WHICH variable it came
    // from) is the difference between "I updated SUPABASE_URL and nothing
    // changed" being a mystery and being obvious: the value may be arriving
    // from the VITE_ fallback because the one you edited is unset, scoped to
    // Builds instead of Functions, or set on a different deploy context.
    url: resolved.url || "(unset)",
    urlSource: resolved.urlSource || "(none)",
    urlRef: urlRef || "(not a *.supabase.co URL)",
    keyRef: claims.ref || `(${claims.format})`,
    keyRole: claims.role || "(unknown)",
    keySource: resolved.keySource || "(none)",
  };

  // Do the server-side vars and the browser-side vars point at the SAME
  // project? They are set independently in Netlify, and nothing has ever
  // compared them. If they disagree, the browser gets a session from one
  // project and these functions validate it against another — so every
  // signed-in request fails while both values look individually correct.
  // That is the same class of bug as the ref mismatch, one level up.
  const serverUrl = String(env.SUPABASE_URL || "").trim();
  const browserUrl = String(env.VITE_SUPABASE_URL || "").trim();
  if (serverUrl && browserUrl) {
    const a = projectRefFromUrl(serverUrl);
    const b = projectRefFromUrl(browserUrl);
    if (a && b && a !== b) {
      return {
        problem: "conflicting_url_vars",
        message:
          `SUPABASE_URL points at project "${a}" but VITE_SUPABASE_URL points at ` +
          `"${b}". These functions use the first and the browser bundle uses the ` +
          "second, so a session issued to the user by one project is validated " +
          "against the other and every signed-in request fails. Point both at " +
          "the same project.",
        detail: { ...detail, serverUrl, browserUrl },
      };
    }
  }

  // A service_role key in an anon slot is the most dangerous thing we can find
  // here: VITE_SUPABASE_ANON_KEY is compiled into the browser bundle, and a
  // service key bypasses RLS entirely — every user could read every other
  // user's rows. Report it above everything else.
  // Same danger, newer key format. An sb_secret_… key carries no role claim
  // to inspect, so the check above cannot see it — the format IS the signal.
  if (claims.format === "secret") {
    return {
      problem: "secret_key_in_anon_slot",
      message:
        `${resolved.keySource} holds an "sb_secret_…" key, not a publishable key. ` +
        "A secret key bypasses Row Level Security and is compiled into the " +
        "browser bundle from VITE_SUPABASE_ANON_KEY — replace it with the " +
        "project's sb_publishable_… key immediately and rotate the leaked secret.",
      detail,
    };
  }

  if (claims.role && claims.role !== "anon") {
    return {
      problem: "service_role_in_anon_slot",
      message:
        `${resolved.keySource} holds a "${claims.role}" key, not an anon key. ` +
        "A service key bypasses Row Level Security and is compiled into the " +
        "browser bundle from VITE_SUPABASE_ANON_KEY — replace it with the " +
        "project's anon/publishable key immediately.",
      detail,
    };
  }

  // Same question for the two anon keys, for the same reason.
  const serverKeyRef = decodeSupabaseKey(String(env.SUPABASE_ANON_KEY || "").trim()).ref;
  const browserKeyRef = decodeSupabaseKey(String(env.VITE_SUPABASE_ANON_KEY || "").trim()).ref;
  if (serverKeyRef && browserKeyRef && serverKeyRef !== browserKeyRef) {
    return {
      problem: "conflicting_key_vars",
      message:
        `SUPABASE_ANON_KEY is issued for project "${serverKeyRef}" but ` +
        `VITE_SUPABASE_ANON_KEY is issued for "${browserKeyRef}". The browser and ` +
        "these functions would authenticate against different projects. Use the " +
        "same project's anon key for both.",
      detail: { ...detail, serverKeyRef, browserKeyRef },
    };
  }

  if (claims.exp && claims.exp * 1000 < Date.now()) {
    return {
      problem: "key_expired",
      message:
        `${resolved.keySource} expired on ${new Date(claims.exp * 1000).toISOString().slice(0, 10)}. ` +
        "Issue a new anon key in Supabase → Settings → API.",
      detail,
    };
  }

  // THE STAGING FAULT. One character apart is still a different project, and
  // Supabase answers "Invalid API key" without ever hinting which side is wrong.
  if (urlRef && claims.ref && urlRef !== claims.ref) {
    return {
      problem: "ref_mismatch",
      message:
        `Project mismatch: SUPABASE_URL points at project "${urlRef}", but ` +
        `${resolved.keySource} is issued for project "${claims.ref}". ` +
        "Supabase rejects this as \"Invalid API key\". Copy the anon key from " +
        `Supabase → project ${urlRef} → Settings → API, or point SUPABASE_URL ` +
        `at https://${claims.ref}.supabase.co — whichever project is the right one.`,
      detail,
    };
  }

  // THE PRODUCTION FAULT. A custom AUTH domain fronts /auth/v1 only, so every
  // PostgREST call the functions make has nothing to talk to. A full custom
  // domain is legitimate, so this is reported as context rather than a verdict
  // — the network checks decide, and this explains the result.
  if (resolved.url && !urlRef) {
    return {
      problem: "custom_domain",
      message:
        `SUPABASE_URL is "${resolved.url}", which is not a *.supabase.co project URL. ` +
        "If this is a custom AUTH domain it fronts /auth/v1 only, so every " +
        "database call these functions make (/rest/v1) has nothing behind it. " +
        "SUPABASE_URL must be the project URL; the custom domain belongs in " +
        "Supabase's own dashboard config for the OAuth callback.",
      detail,
    };
  }

  return { problem: null, message: null, detail };
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

/**
 * Operator-facing text for a key/URL mismatch, naming what to check.
 *
 * Prefers the OFFLINE diagnosis, which can usually say exactly which project
 * each side belongs to — far more actionable than "they do not match", which
 * is all this said before and is why the same values got re-pasted twice.
 */
export function invalidApiKeyMessage(env = process.env) {
  const identity = diagnoseSupabaseIdentity(env);
  if (identity.problem) return identity.message;
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
