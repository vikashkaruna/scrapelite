// netlify/functions/account-state.js — the account's own danger zone.
//
//   GET    /api/account-state           the current freeze / deletion state
//   POST   /api/account-state           { action: "freeze" | "unfreeze"
//                                       | "request_deletion" | "cancel_deletion",
//                                         reason?, confirm? }
//
// ⚠️ SIGNED-IN ONLY, and the user_id is ALWAYS resolved from the Authorization
// JWT, NEVER from the body. Same class of bug as verify-payment.js once
// trusting a client-supplied planId: a caller that could name its own user_id
// could freeze — or schedule the deletion of — somebody else's account.
//
// ⚠️ THIS ENDPOINT DELETES NOTHING. `request_deletion` records intent, freezes
// the account so nothing accrues, and sets a purge date 30 days out. The
// destructive path stays billing-purge.js, which has five interlocks, ships
// disarmed and caps its own blast radius. Adding a second one here — reachable
// from a button — would mean a mis-click could do what the careful path
// deliberately makes hard.
//
// ── WHY DELETION REQUIRES A TYPED CONFIRMATION ─────────────────────────────
// The client asks the user to type DELETE and sends it as `confirm`. The server
// checks it too. That is not belt-and-braces theatre: this endpoint is
// reachable by anything holding a valid JWT, and the confirmation is the only
// part of the request that is evidence of intent rather than of authentication.

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import {
  getAccountState, setAccountFrozen, requestAccountDeletion, cancelAccountDeletion,
} from "./lib/accountState.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  body: JSON.stringify(body),
});

/** The word the user must type. Compared case-sensitively — a deliberate act. */
export const DELETE_CONFIRMATION = "DELETE";

/** Turn a database verdict into copy a person can act on. Branches on the CODE. */
export function describeFailure(code) {
  switch (code) {
    case "deletion_pending":
      return "This account is scheduled for deletion. Cancel that first — it is what lifts the freeze.";
    case "not_pending":
      return "There is no pending deletion to cancel.";
    case "not_found":
      // Reachable only if the authenticated user_id doesn't correspond to a
      // real account at all — see supabase/migrations/0035, which bootstraps
      // a default entitlements row for any real signed-in user (billing
      // history or not) before freezing/deleting, so this is no longer what
      // a free user with no purchase history sees.
      return "We could not find this account. Try signing in again.";
    case "unavailable":
      return "Account settings are temporarily unavailable. Nothing was changed.";
    default:
      return "That did not go through. Nothing was changed.";
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  // Was calling authenticateBearer(<header string>) — the helper takes the
  // FULL event object and reads the header itself (event.headers.authorization),
  // so a bare string always resolved to an empty header and this endpoint
  // 401'd unconditionally for every signed-in user. fetchAccountState() on the
  // client treats any non-OK response as {available:false} by design (never
  // throws), so DangerZone.jsx's own `if (!state?.available) return null`
  // silently rendered nothing — no error anywhere, the whole section just
  // never appeared. Every other function in this directory already calls
  // authenticateBearer(event, {label}) correctly; this was the one outlier.
  const auth = await authenticateBearer(event, { label: "account-state" });
  if (!auth.ok) {
    return json(auth.status, { ...auth.body, code: "AUTH_REQUIRED" });
  }
  const userId = auth.user.id;

  if (event.httpMethod === "GET") {
    return json(200, { state: await getAccountState(userId) });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { /* handled below */ }
  const action = String(body.action || "");

  if (action === "freeze") {
    const r = await setAccountFrozen(userId, true, body.reason);
    if (!r.ok) return json(409, { error: describeFailure(r.error), code: r.error });
    return json(200, { state: await getAccountState(userId), frozen: true });
  }

  if (action === "unfreeze") {
    const r = await setAccountFrozen(userId, false);
    if (!r.ok) return json(409, { error: describeFailure(r.error), code: r.error });
    return json(200, { state: await getAccountState(userId), frozen: false });
  }

  if (action === "request_deletion") {
    // Checked server-side as well as in the dialog. The dialog proves a person
    // was looking at a warning; this proves the request carried their intent.
    if (body.confirm !== DELETE_CONFIRMATION) {
      return json(400, {
        error: `Type ${DELETE_CONFIRMATION} to confirm.`,
        code: "CONFIRMATION_REQUIRED",
      });
    }
    const r = await requestAccountDeletion(userId);
    if (!r.ok) return json(409, { error: describeFailure(r.error), code: r.error });
    return json(200, {
      state: await getAccountState(userId),
      purgeAfter: r.purgeAfter,
      graceDays: r.graceDays,
    });
  }

  if (action === "cancel_deletion") {
    const r = await cancelAccountDeletion(userId);
    if (!r.ok) return json(409, { error: describeFailure(r.error), code: r.error });
    return json(200, { state: await getAccountState(userId) });
  }

  return json(400, { error: "Unknown action.", code: "UNKNOWN_ACTION" });
};
