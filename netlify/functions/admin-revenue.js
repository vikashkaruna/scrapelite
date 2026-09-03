// admin-revenue.js — revenue KPIs and trend from live Supabase data.
// GET /api/admin-revenue — token-gated; falls back to zero state when Supabase unconfigured.
import { bearerFromEvent, verifyAdminToken } from "./lib/adminToken.js";
import { buildPqlFunnel } from "../../src/lib/pql/funnelModel.js";

// Static plan prices (USD/mo) — mirrors pricingConfig.js.
// Operator can't override these server-side without pricing_config table, which is fine
// for display purposes. Revenue numbers are sourced from payment_events amounts.
const PLAN_PRICES_USD = { free: 0, select: 19, pro: 29, business: 79, agency: 299 };

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

function emptyMetrics() {
  return {
    mrr: 0, arr: 0,
    totalUsers: 0, payingUsers: 0, freeUsers: 0,
    byPlan: { free: 0, select: 0, pro: 0, business: 0, agency: 0 },
    newThisMonth: 0, couponUsage: 0,
  };
}

function emptyTrend() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - (5 - i));
    return { label: d.toLocaleString("default", { month: "short", year: "2-digit" }), mrr: 0 };
  });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod !== "GET") return respond(405, { error: "Method not allowed." });

  const tok  = bearerFromEvent(event);
  const auth = verifyAdminToken(tok);
  if (!auth.ok) return respond(401, { error: auth.reason });

  const db = getDb();

  if (!db) {
    return respond(200, {
      metrics: emptyMetrics(),
      trend: emptyTrend(),
      fromSeed: true,
      warning: "SUPABASE_URL + SUPABASE_SERVICE_KEY not set — showing zero state.",
    });
  }

  try {
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);

    // Parallel fetch: auth users, active subscriptions, payment events, coupon redemptions.
    const [authData, subs, paymentEvents, couponRecs, pqlRows] = await Promise.all([
      sbFetch(db, "/auth/v1/admin/users?per_page=1000&page=1"),
      sbFetch(db, "/rest/v1/subscriptions?select=plan_id,status,current_period_end").catch(() => []),
      sbFetch(db, "/rest/v1/payment_events?select=amount_cents,currency,created_at,status&order=created_at.desc&limit=5000").catch(() => []),
      sbFetch(db, "/rest/v1/coupon_redemptions?select=id&limit=5000").catch(() => []),
      // .catch(() => []) like its neighbours: an empty pql_scores table and an
      // absent one are both "no funnel data", and neither should take down the
      // revenue dashboard. Distinguished for the reader by `funnelAvailable`.
      sbFetch(db, "/rest/v1/pql_scores?select=score,coverage,is_pql,activated,persona&limit=5000").catch(() => null),
    ]);

    const authUsers  = Array.isArray(authData?.users) ? authData.users : [];
    const activeSubs = (Array.isArray(subs) ? subs : []).filter((s) => s.status === "active");

    // ── Plan distribution ────────────────────────────────────────────────────────
    const byPlan = { free: 0, select: 0, pro: 0, business: 0, agency: 0 };
    let mrr = 0;
    for (const s of activeSubs) {
      const planId = s.plan_id || "free";
      if (planId !== "free") {
        byPlan[planId] = (byPlan[planId] ?? 0) + 1;
        mrr += PLAN_PRICES_USD[planId] ?? 0;
      }
    }
    const payingUsers = activeSubs.filter((s) => s.plan_id && s.plan_id !== "free").length;
    byPlan.free = Math.max(0, authUsers.length - payingUsers);

    // ── Monthly trend from payment_events ────────────────────────────────────────
    // Accepted captured/succeeded statuses across Razorpay + Stripe.
    const CAPTURED = new Set(["captured", "succeeded", "paid", "completed"]);
    const monthlyUsd = {};
    for (const e of (Array.isArray(paymentEvents) ? paymentEvents : [])) {
      if (!CAPTURED.has(e.status)) continue;
      const month = (e.created_at || "").slice(0, 7);
      if (!month) continue;
      // Convert INR paise → USD; USD cents → USD.
      const usd = e.currency === "INR"
        ? (e.amount_cents || 0) / 100 / 83.5  // ₹ → USD at ~83.5
        : (e.amount_cents || 0) / 100;
      monthlyUsd[month] = (monthlyUsd[month] || 0) + usd;
    }

    const trend = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now);
      d.setMonth(d.getMonth() - (5 - i));
      const key   = d.toISOString().slice(0, 7);
      const label = d.toLocaleString("default", { month: "short", year: "2-digit" });
      return { label, mrr: Math.round(monthlyUsd[key] || 0) };
    });

    // ── Other KPIs ───────────────────────────────────────────────────────────────
    const newThisMonth = authUsers.filter(
      (u) => (u.created_at || "").slice(0, 7) === currentMonth
    ).length;

    const couponUsage = Array.isArray(couponRecs) ? couponRecs.length : 0;

    const metrics = {
      mrr, arr: mrr * 12,
      totalUsers: authUsers.length,
      payingUsers,
      freeUsers: byPlan.free,
      byPlan,
      newThisMonth,
      couponUsage,
    };

    // `funnelAvailable: false` means the table could not be read at all —
    // usually migration 0040 not yet applied. That is a DIFFERENT statement
    // from "zero users have activated", and the UI must be able to tell them
    // apart or it will report an unapplied migration as a product failure.
    const funnelAvailable = Array.isArray(pqlRows);
    return respond(200, {
      metrics,
      trend,
      fromSeed: false,
      funnelAvailable,
      funnel: funnelAvailable ? buildPqlFunnel(pqlRows) : null,
    });
  } catch (err) {
    return respond(200, {
      metrics: emptyMetrics(),
      trend: emptyTrend(),
      fromSeed: true,
      warning: `Supabase error: ${err.message}`,
    });
  }
};
