// admin-users.js — admin user management via Supabase Auth admin API.
//
// GET   /api/admin-users — list all registered users (token-gated)
// PATCH /api/admin-users — extend bonus extractions OR issue a grant coupon (token-gated)
// POST  /api/admin-users — send Supabase invite (token-gated)
//
// Falls back gracefully when SUPABASE_URL / SUPABASE_SERVICE_KEY are absent.
import { bearerFromEvent, verifyAdminToken } from "./lib/adminToken.js";
import { PLAN_BY_ID } from "../../src/lib/pricingConfig.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function respond(status, data) {
  return { statusCode: status, headers: HEADERS, body: JSON.stringify(data) };
}

function getDb() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return { url, key };
}

async function sbFetch(db, path, opts = {}) {
  const res = await fetch(`${db.url}${path}`, {
    ...opts,
    headers: {
      apikey: db.key,
      Authorization: `Bearer ${db.key}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Supabase ${path} → ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };

  // All methods require admin auth.
  const tok = bearerFromEvent(event);
  const auth = verifyAdminToken(tok);
  if (!auth.ok) return respond(401, { error: auth.reason });

  const db = getDb();

  // ── GET — list all registered users ──────────────────────────────────────────
  if (event.httpMethod === "GET") {
    if (!db) {
      return respond(200, {
        users: [],
        fromSeed: true,
        warning: "SUPABASE_URL + SUPABASE_SERVICE_KEY not set — cannot load real users.",
      });
    }
    try {
      const currentMonth = new Date().toISOString().slice(0, 7); // e.g. "2026-06"

      // 1. All registered Supabase auth users (up to 1000).
      const authData = await sbFetch(db, "/auth/v1/admin/users?per_page=1000&page=1");
      const authUsers = Array.isArray(authData.users) ? authData.users : [];

      // 2. Subscriptions — include period dates for plan start/end display.
      const subs = await sbFetch(
        db,
        "/rest/v1/subscriptions?select=session_id,plan_id,status,provider,provider_customer_id,current_period_start,current_period_end"
      ).catch(() => []);
      const ents = await sbFetch(
        db,
        "/rest/v1/entitlements?select=user_id,plan_id,status,source,period_start,period_end"
      ).catch(() => []);

      // 3. Current-month usage records for extraction counts.
      const usageRecs = await sbFetch(
        db,
        `/rest/v1/usage_records?select=session_id,extractions&month=eq.${currentMonth}`
      ).catch(() => []);

      // 4. Coupon redemptions — most-recent coupon per session_id.
      //    Ordered desc so first entry per session is the latest.
      const couponRecs = await sbFetch(
        db,
        "/rest/v1/coupon_redemptions?select=session_id,coupon_code&order=created_at.desc&limit=5000"
      ).catch(() => []);
      const grantRecs = await sbFetch(
        db,
        "/rest/v1/admin_coupon_assignments?select=*&order=assigned_at.desc&limit=5000"
      ).catch(() => []);

      // Build lookup maps.
      const subMap = {};
      for (const s of subs) {
        subMap[s.session_id] = s;
        if (s.provider_customer_id) subMap[s.provider_customer_id] = s;
      }
      const usageMap = {};
      for (const r of usageRecs) {
        usageMap[r.session_id] = r;
      }
      const entMap = {};
      for (const e of ents) entMap[e.user_id] = e;
      // First entry wins (desc order = latest coupon per session).
      const couponMap = {};
      for (const c of couponRecs) {
        if (!couponMap[c.session_id]) couponMap[c.session_id] = c.coupon_code;
      }
      const grantMap = {};
      for (const g of grantRecs) {
        if (!grantMap[g.user_id]) grantMap[g.user_id] = g;
      }

      const today = new Date().toISOString().slice(0, 10);

      const users = authUsers.map((au) => {
        const meta    = au.raw_user_meta_data || {};
        const appMeta = au.app_metadata || {};
        const sub     = subMap[au.id] || null;
        const ent     = entMap[au.id] || null;
        const usage   = usageMap[au.id] || null;
        const grant   = grantMap[au.id] || null;

        const name   = meta.full_name || meta.name || au.email?.split("@")[0] || "User";
        const planId = ent?.plan_id || sub?.plan_id || appMeta.plan_id || meta.plan_id || "free";

        // Coupon: prefer admin-assigned (user metadata), then payment-flow redemption.
        const couponAvailed  = meta.coupon_availed || couponMap[au.id] || null;
        const couponDiscount = meta.coupon_availed ? (meta.coupon_discount ?? null) : null;
        const couponPlanId   = meta.coupon_availed ? (meta.coupon_plan_id ?? null) : null;

        return {
          id:                   au.id,
          name,
          email:                au.email || "",
          planId,
          planStart:            ent?.period_start?.slice(0, 10) || sub?.current_period_start?.slice(0, 10) || null,
          planEnd:              ent?.period_end?.slice(0, 10) || sub?.current_period_end?.slice(0, 10) || null,
          couponAvailed,
          couponDiscount,
          couponPlanId,
          bonusExtractions:     Number(meta.bonus_extractions || 0),
          source:               meta.source || appMeta.provider || "organic",
          joinedAt:             (au.created_at || today).slice(0, 10),
          extractionsThisMonth: usage?.extractions ?? 0,
          lastActive:           (au.last_sign_in_at || au.created_at || today).slice(0, 10),
          inviteSent:           !au.email_confirmed_at,
          confirmed:            !!au.email_confirmed_at,
          provider:             appMeta.provider || sub?.provider || null,
          adminGrantCoupon:     grant ? {
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
        };
      });

      return respond(200, { users, fromSeed: false });
    } catch (err) {
      return respond(200, {
        users: [],
        fromSeed: true,
        warning: `Supabase error: ${err.message}`,
      });
    }
  }

  // ── PATCH — extend bonus extractions OR issue/revoke a grant coupon ───────────
  if (event.httpMethod === "PATCH") {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return respond(400, { error: "Invalid JSON body." }); }

    if (!db) {
      if (body.action === "assign_grant_coupon") {
        const { userId, couponCode, planId, validityMonths, claimExpiresAt } = body;
        return respond(200, {
          ok: true,
          userId,
          adminGrantCoupon: {
            id: `grant_${Date.now()}`,
            code: (couponCode || "DEMO").trim().toUpperCase(),
            planId: planId || "pro",
            validityMonths: Number(validityMonths || 1),
            claimExpiresAt: claimExpiresAt || null,
            status: "assigned",
            assignedAt: new Date().toISOString(),
          },
          localOnly: true,
        });
      }
      return respond(503, { error: "Supabase not configured." });
    }
    try {

      // ── issue a user-specific, non-recurring plan grant ──
      if (body.action === "assign_grant_coupon") {
        const { userId, couponCode, planId, validityMonths, claimExpiresAt, reason } = body;
        if (!userId || !couponCode?.trim() || !planId) {
          return respond(400, { error: "userId, couponCode, and planId are required." });
        }
        if (!reason?.trim()) return respond(400, { error: "A reason is required for a plan grant." });
        if (!PLAN_BY_ID[planId]) return respond(400, { error: `Unknown plan '${planId}'.` });
        const months = Number(validityMonths);
        if (!Number.isInteger(months) || months < 1 || months > 24) {
          return respond(400, { error: "validityMonths must be a whole number between 1 and 24." });
        }
        const code = couponCode.trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9_-]{3,23}$/.test(code)) {
          return respond(400, { error: "Coupon code must be 4–24 letters, numbers, hyphens, or underscores." });
        }
        if (claimExpiresAt && Number.isNaN(Date.parse(claimExpiresAt))) {
          return respond(400, { error: "claimExpiresAt must be a valid date." });
        }
        if (claimExpiresAt && Date.parse(claimExpiresAt) <= Date.now()) {
          return respond(400, { error: "claimExpiresAt must be in the future." });
        }

        // Verifies the target is an existing Auth user before the database RPC
        // creates the assignment.
        await sbFetch(db, `/auth/v1/admin/users/${encodeURIComponent(userId)}`);
        const raw = await sbFetch(db, "/rest/v1/rpc/create_admin_coupon_assignment", {
          method: "POST",
          body: JSON.stringify({
            p_user_id: userId,
            p_code: code,
            p_plan_id: planId,
            p_validity_months: months,
            p_claim_expires_at: claimExpiresAt || null,
            p_actor: auth.demo ? "admin:demo" : "admin",
            p_reason: reason.trim(),
          }),
        });
        const grant = Array.isArray(raw) ? raw[0] : raw;
        return respond(200, {
          ok: true,
          userId,
          adminGrantCoupon: {
            id: grant.id,
            code: grant.code,
            planId: grant.plan_id,
            validityMonths: grant.validity_months,
            claimExpiresAt: grant.claim_expires_at,
            status: grant.status,
            assignedAt: grant.assigned_at,
          },
        });
      }

      // The previous path changed paid checkout state and is intentionally
      // disabled. Existing callers must use assign_grant_coupon.
      if (body.action === "assign_coupon") {
        return respond(410, { error: "Legacy admin discount assignment is disabled. Issue a complimentary plan grant instead." });
      }

      // ── extend bonus extractions (default) ──
      const { userId, bonus } = body;
      if (!userId || !Number.isFinite(Number(bonus)) || Number(bonus) < 1) {
        return respond(400, { error: "userId and bonus (≥1) required." });
      }

      const au   = await sbFetch(db, `/auth/v1/admin/users/${userId}`);
      const meta = au.raw_user_meta_data || {};
      const newBonus = Number(meta.bonus_extractions || 0) + Number(bonus);

      await sbFetch(db, `/auth/v1/admin/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify({ user_metadata: { ...meta, bonus_extractions: newBonus } }),
      });

      return respond(200, { ok: true, userId, newBonus });
    } catch (err) {
      if (/coupon_code_already_exists|duplicate key|already exists/i.test(err.message)) {
        return respond(409, { error: "That grant coupon code is already assigned. Choose another code." });
      }
      return respond(500, { error: err.message });
    }
  }

  // ── POST — invite a new user via Supabase Auth ────────────────────────────────
  if (event.httpMethod === "POST") {
    if (!db) {
      return respond(503, {
        error: "Supabase not configured — invite saved locally only.",
        localOnly: true,
      });
    }
    try {
      const body = JSON.parse(event.body || "{}");
      const { email, name, planId, source } = body;
      if (!email) return respond(400, { error: "email required." });

      const siteUrl = process.env.URL || process.env.DEPLOY_URL || "https://datiq.app";
      const result  = await sbFetch(db, "/auth/v1/admin/invite", {
        method: "POST",
        body: JSON.stringify({
          email,
          data: { name: name || "", source: source || "invite", plan_id: planId || "free" },
          redirect_to: `${siteUrl}/onboarding`,
        }),
      });

      return respond(200, { ok: true, userId: result.id, email });
    } catch (err) {
      if (/already (been )?register|already exists/i.test(err.message)) {
        return respond(409, { error: "A user with this email already exists." });
      }
      return respond(500, { error: err.message });
    }
  }

  return respond(405, { error: "Method not allowed." });
};
