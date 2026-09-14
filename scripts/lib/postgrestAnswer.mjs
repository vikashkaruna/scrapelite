// scripts/lib/postgrestAnswer.mjs
//
// One predicate, shared by every script that concludes something from a refusal.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// An anonymous PostgREST probe is how this repo proves an RLS migration was
// actually applied — `verify-workflow-rls.mjs` and the security section of
// `verify-discoverability-e2e.mjs` both rest on it. The reasoning is: a 401 or
// 403 means the row-level policy refused us, so the lockdown is live.
//
// 🔴 THAT REASONING HAS A HOLE, AND IT WAS FOUND BY FALLING INTO IT. Run the
// check from behind an egress proxy that allow-lists hosts — a CI sandbox, a
// corporate network, a VPN — and every request is answered 403 by the PROXY,
// with `x-deny-reason: host_not_allowed` and a plain-text body, before it ever
// reaches Supabase. The old loop counted each of those as a refusal and printed
// "All 15 tables refuse anonymous reads. 0044 is applied." from a machine that
// had never contacted the project at all.
//
// A security gate that reports "locked down" when it could not reach the host
// is worse than no gate: it is a green light nobody will look behind. The
// script already handled a *thrown* network error correctly; it missed the case
// where something in the middle answers ON the host's behalf, which does not
// throw and looks exactly like a real HTTP response.
//
// ── THE TEST ───────────────────────────────────────────────────────────────
//
// PostgREST answers in JSON, always, including its errors — `{code, message,
// details, hint}`. A proxy answers with its own content type and its own prose.
// So: a non-200 is evidence about the database ONLY if it looks like PostgREST
// wrote it. Anything else is INCONCLUSIVE, which is a third verdict and not a
// synonym for either of the other two.

/** Headers a proxy sets to explain itself. Presence of any is conclusive. */
const DENY_HEADERS = ["x-deny-reason", "x-proxy-denied", "x-blocked-reason"];

/**
 * Did this response come from PostgREST, or from something standing in front of
 * it?
 *
 * @param {{status:number, headers?:Headers, text?:string}} res
 * @returns {{ fromPostgrest: boolean, reason: string|null }}
 *   `fromPostgrest: true`  — the status means what you think it means.
 *   `fromPostgrest: false` — INCONCLUSIVE; `reason` says who answered instead.
 */
export function postgrestAnswer(res) {
  if (!res || res.status === 0) {
    return { fromPostgrest: false, reason: res?.error || "the request did not complete" };
  }
  for (const h of DENY_HEADERS) {
    const v = res.headers?.get?.(h);
    if (v) return { fromPostgrest: false, reason: `a proxy refused the connection (${h}: ${v})` };
  }
  // A 200 can only have come from the database — no proxy invents rows.
  if (res.status === 200) return { fromPostgrest: true, reason: null };

  const ct = res.headers?.get?.("content-type") || "";
  const body = (res.text || "").trim();

  if (/json/i.test(ct)) return { fromPostgrest: true, reason: null };
  if (body.startsWith("{") || body.startsWith("[")) return { fromPostgrest: true, reason: null };

  // Non-JSON on a non-200. Something else wrote this.
  const first = body.split("\n")[0].slice(0, 140);
  return {
    fromPostgrest: false,
    reason: first
      ? `HTTP ${res.status} in ${ct || "an unknown content type"} — not a PostgREST reply: "${first}"`
      : `HTTP ${res.status} with an empty ${ct || "untyped"} body — not a PostgREST reply`,
  };
}
