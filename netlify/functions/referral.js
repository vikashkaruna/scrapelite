// netlify/functions/referral.js
//
// The referral loop: invite a friend, you both get 25 extractions.
//
//   GET  /api/referral            → { code, referrals, bonus }
//   POST /api/referral { code }   → redeem someone else's code
//
// ⚠️ WHY THIS IS SERVER-SIDE AT ALL. A referral grants real, paid quota. The
// previous implementation kept the code, the bonus and the self-referral check
// in the beneficiary's own localStorage, which meant the reward was both
// forgeable and — because nothing read the key it wrote to — never actually
// granted. Codes are minted by the database, rewards are applied by the
// database, and this handler resolves the user from the JWT and passes nothing
// else through.
//
// ⚠️ SIGNED-IN ONLY, both directions. The user id is never read from the
// request body; only `code` is. An anonymous identity can be cleared and
// re-made without limit, so it is not something a reward can be attributed to
// — the same reasoning as scrape-consent.js. The advertised flow already reads
// "when they sign up with your link", so a guest arriving on ?ref= stashes the
// code client-side and redeems it once a session exists.

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import {
  getOrIssueCode,
  redeemCode,
  getReferralStats,
  REFERRAL_BONUS,
} from "./lib/referrals.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// User-facing copy per refusal reason. Kept here rather than in the client so
// the two can never drift into saying different things about the same verdict.
const REASON_COPY = {
  invalid: "That invite code doesn't exist. Check it and try again.",
  self: "You can't redeem your own invite code.",
  already: "You've already used an invite code on this account.",
  unavailable: "Referrals are temporarily unavailable. Please try again shortly.",
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const auth = await authenticateBearer(event, { label: "referral" });
  if (!auth.ok) {
    return respond(auth.status || 401, auth.body || { error: "Authentication required" });
  }
  const userId = auth.user.id;

  if (event.httpMethod === "GET") {
    const [{ code, degraded }, stats] = await Promise.all([
      getOrIssueCode(userId),
      getReferralStats(userId),
    ]);
    return respond(200, {
      ok: true,
      code,
      referrals: stats.referrals,
      bonus: stats.bonus,
      bonusPerReferral: REFERRAL_BONUS,
      // `true` means the store could not answer, so `code` is null and the UI
      // must not invent one. It is NOT an error — the banner simply hides.
      degraded: degraded || stats.degraded,
    });
  }

  if (event.httpMethod === "POST") {
    let body = {};
    try { body = event.body ? JSON.parse(event.body) : {}; }
    catch { return respond(400, { error: "Invalid JSON body" }); }

    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) return respond(400, { error: "An invite code is required", reason: "invalid" });

    const result = await redeemCode(userId, code);
    if (!result.ok) {
      // 409 for "already"/"self" — the request was understood and refused on
      // state, not malformed. 503 when the store is down, so the client can
      // retry rather than telling the user their code is bad.
      const status = result.reason === "unavailable" ? 503 : 409;
      return respond(status, {
        ok: false,
        reason: result.reason,
        error: REASON_COPY[result.reason] || REASON_COPY.invalid,
      });
    }
    return respond(200, { ok: true, bonus: result.bonus });
  }

  return respond(405, { error: "Method not allowed" });
};
