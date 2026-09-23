// credits.js — GET /api/credits. The caller's own credit position.
//
// ⚠️ READ-ONLY, AND FOR PAINTING A SCREEN. Nothing here authorises anything.
// Every gate re-resolves the balance server-side at the moment it charges,
// with the service key, because a balance the browser holds is a hint the user
// is free to tamper with — the same rule entitlementClient.js states for the
// entitlement row.
//
// 🔴 `enforced: false` IS NOT `available: 0`.
// An account that has never been granted credits is not on the credit system,
// and a UI that rendered "0 credits remaining" for it would be telling every
// customer they were out of something they had never been given. The flag is
// what separates the two, and the screen must branch on it.

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { available } from "./lib/creditMeter.js";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: {} };
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const auth = await authenticateBearer(event, { label: "credits" });
  if (!auth.ok || !auth.user) {
    // A guest has no ledger to read. Answered rather than refused, so the UI
    // renders the signed-out state instead of an error banner.
    return json(200, { enforced: false, guest: true, available: 0, grants: 0 });
  }

  const status = await available(auth.user.id);
  if (status.degraded) {
    // ⚠️ "We could not read it" is not "you have none". Said explicitly so the
    // screen shows nothing rather than a confident zero.
    return json(200, {
      enforced: false, degraded: true, available: null, reason: status.reason,
    });
  }

  return json(200, {
    enforced: status.enforced,
    available: status.available,
    grants: status.grants,
    granted: status.granted,
    spent: status.spent,
  });
};
