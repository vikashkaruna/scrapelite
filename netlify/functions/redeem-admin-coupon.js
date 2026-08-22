// redeem-admin-coupon.js — authenticated self-redemption of a complimentary
// plan grant. This endpoint is deliberately separate from create-checkout:
// grant coupons never change a paid charge and never create a subscription.

import { authenticateBearer } from "./lib/supabaseServerClient.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
    body: JSON.stringify(body),
  };
}

function serviceDb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  };
}

async function request(db, path, method = "GET", body) {
  const res = await fetch(`${db.base}${path}`, {
    method,
    headers: db.headers,
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${path} → ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json().catch(() => null);
}

function statusFor(code) {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "INVALID_GRANT") return 404;
  if (code === "ACTIVE_ENTITLEMENT" || code === "GRANT_ALREADY_USED" || code === "GRANT_EXPIRED") return 409;
  return 400;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" });

  const auth = await authenticateBearer(event, { label: "redeem-admin-coupon" });
  if (!auth.ok) return json(auth.status, auth.body);

  const db = serviceDb();
  if (!db) return json(503, { error: "Supabase is not configured." });

  try {
    if (event.httpMethod === "GET") {
      const rows = await request(
        db,
        `/admin_coupon_assignments?user_id=eq.${encodeURIComponent(auth.user.id)}&select=*&order=assigned_at.desc&limit=1`,
      );
      const grant = Array.isArray(rows) ? rows[0] : null;
      return json(200, {
        grant: grant ? {
          id: grant.id,
          code: grant.code,
          planId: grant.plan_id,
          validityMonths: grant.validity_months,
          claimExpiresAt: grant.claim_expires_at,
          status: grant.status,
          assignedAt: grant.assigned_at,
          redeemedAt: grant.redeemed_at,
          periodStart: grant.redemption_period_start,
          periodEnd: grant.redemption_period_end,
        } : null,
      });
    }

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "Invalid JSON body." }); }
    const code = String(body.code || "").trim().toUpperCase();
    if (!code) return json(400, { error: "Grant coupon code is required.", code: "CODE_REQUIRED" });

    const result = await request(db, "/rpc/redeem_admin_coupon", "POST", {
      p_user_id: auth.user.id,
      p_code: code,
    });
    if (!result?.ok) return json(statusFor(result?.code), result || { error: "Grant redemption failed." });

    return json(200, result);
  } catch (err) {
    console.error("[redeem-admin-coupon]", err?.message);
    return json(500, { error: "Grant redemption failed." });
  }
};
