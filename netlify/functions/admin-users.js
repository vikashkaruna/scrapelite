// admin-users.js — admin user management via Supabase Auth admin API.
//
// GET   /api/admin-users — list all registered users (token-gated)
// PATCH /api/admin-users — extend bonus extractions OR assign coupon (token-gated)
// POST  /api/admin-users — send Supabase invite (token-gated)
//
// Falls back gracefully when SUPABASE_URL / SUPABASE_SERVICE_KEY are absent.
import { bearerFromEvent, verifyAdminToken } from "./lib/adminToken.js";

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
      // First entry wins (desc order = latest coupon per session).
      const couponMap = {};
      for (const c of couponRecs) {
        if (!couponMap[c.session_id]) couponMap[c.session_id] = c.coupon_code;
      }

      const today = new Date().toISOString().slice(0, 10);

      const users = authUsers.map((au) => {
        const meta    = au.raw_user_meta_data || {};
        const appMeta = au.app_metadata || {};
        const sub     = subMap[au.id] || null;
        const usage   = usageMap[au.id] || null;

        const name   = meta.full_name || meta.name || au.email?.split("@")[0] || "User";
        const planId = sub?.plan_id || appMeta.plan_id || meta.plan_id || "free";

        // Coupon: prefer admin-assigned (user metadata), then payment-flow redemption.
        const couponAvailed  = meta.coupon_availed || couponMap[au.id] || null;
        const couponDiscount = meta.coupon_availed ? (meta.coupon_discount ?? null) : null;
        const couponPlanId   = meta.coupon_availed ? (meta.coupon_plan_id ?? null) : null;

        return {
          id:                   au.id,
          name,
          email:                au.email || "",
          planId,
          planStart:            sub?.current_period_start?.slice(0, 10) || null,
          planEnd:              sub?.current_period_end?.slice(0, 10) || null,
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

  // ── PATCH — extend bonus extractions OR assign coupon ─────────────────────────
  if (event.httpMethod === "PATCH") {
    if (!db) return respond(503, { error: "Supabase not configured." });
    try {
      const body = JSON.parse(event.body || "{}");

      // ── assign coupon ──
      if (body.action === "assign_coupon") {
        const { userId, couponCode, discountPct, planId } = body;
        if (!userId || !couponCode?.trim()) {
          return respond(400, { error: "userId and couponCode required." });
        }
        const code = couponCode.trim().toUpperCase();
        const restrictPlanId = planId || null;

        // Update auth user metadata. coupon_plan_id is the PER-ASSIGNMENT plan
        // restriction (not the coupon's own planId, which is the client-side
        // "manual" sentinel) — null means usable on any plan.
        const au   = await sbFetch(db, `/auth/v1/admin/users/${userId}`);
        const meta = au.raw_user_meta_data || {};
        await sbFetch(db, `/auth/v1/admin/users/${userId}`, {
          method: "PUT",
          body: JSON.stringify({
            user_metadata: {
              ...meta,
              coupon_availed:   code,
              coupon_discount:  discountPct != null ? Number(discountPct) : (meta.coupon_discount ?? null),
              coupon_plan_id:   restrictPlanId,
            },
          }),
        });

        // Also upsert into coupon_redemptions so the GET join (couponMap[au.id]) reliably
        // returns the coupon even if auth metadata caching causes a brief stale read.
        await sbFetch(db, "/rest/v1/coupon_redemptions", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ coupon_code: code, session_id: userId, order_ref: "admin-assigned" }),
        }).catch(() => {}); // non-fatal if coupon_redemptions table doesn't exist yet

        // Mirror into pricing_config.coupons — the SAME server-authoritative table
        // create-checkout.js reads via pricingSource.loadPricing(). Without this,
        // the coupon looks right in the UI but the server has no matching record to
        // apply at actual checkout (its client-side "manual" sentinel is not a real
        // plan id, so it can never satisfy the plan-match check there). maxUses: 1
        // scopes it to a single redemption, since it exists for exactly this
        // assignment — checkout enforcement is per browser session, same as every
        // other coupon in the system (see pricingSource.reserveCoupon), so this is
        // not equivalent to true per-user identity enforcement, just consistent
        // with the rest of the coupon system's existing security posture.
        if (typeof discountPct === "number" && discountPct > 0) {
          try {
            const rows = await sbFetch(db, "/rest/v1/pricing_config?select=key,value&key=eq.coupons");
            const existing = (rows && rows[0] && rows[0].value) || {};
            const merged = {
              ...existing,
              [code]: {
                value: Number(discountPct),
                planId: restrictPlanId,
                active: true,
                maxUses: 1,
                expiresAt: existing[code]?.expiresAt || null,
              },
            };
            await sbFetch(db, "/rest/v1/pricing_config", {
              method: "POST",
              headers: { Prefer: "resolution=merge-duplicates" },
              body: JSON.stringify({ key: "coupons", value: merged }),
            });
          } catch (mirrorErr) {
            // Non-fatal — the assignment still displays on the user's Account
            // page even if the server-side mirror write failed; only the actual
            // checkout discount would be missing until this is retried.
            console.warn("[admin-users] pricing_config.coupons mirror failed:", mirrorErr.message);
          }
        }

        return respond(200, { ok: true, userId, couponCode: code, discountPct: discountPct ?? null, planId: restrictPlanId });
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
