// adminService.js — V5 admin module: coupons, user management, revenue metrics.
// All data is localStorage-persisted (production would use Supabase + server).

const COUPONS_KEY = "datiq.coupons";
const ADMIN_USERS_KEY = "datiq.adminUsers";
const ADMIN_AUTH_KEY  = "scrapelite.adminAuth";     // now holds the session token
const ADMIN_EXP_KEY   = "scrapelite.adminAuthExp";  // token expiry (ms epoch)
const ADMIN_LOCK_KEY  = "datiq.adminLock";          // failed-attempt lockout state

const FUNCTIONS = "/.netlify/functions";
const DEMO_PIN  = "ADMIN123";
const EIGHT_H   = 1000 * 60 * 60 * 8;

export const ADMIN_MAX_ATTEMPTS = 5;
const ADMIN_LOCK_MS = 60_000; // 60s lockout after MAX attempts

function ls(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function lsSet(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ── Auth ──────────────────────────────────────────────────────────────────────
// The admin PIN is verified SERVER-SIDE (netlify/functions/admin-auth.js); the secret
// never ships in the bundle. A successful login stores a short-lived signed token.
export function isAdminAuthed() {
  const tok = localStorage.getItem(ADMIN_AUTH_KEY);
  if (!tok || tok === "true" || tok === "1") return false; // reject legacy boolean → re-auth
  const exp = Number(localStorage.getItem(ADMIN_EXP_KEY) || 0);
  if (exp && Date.now() > exp) { adminLogout(); return false; }
  return true;
}

// Returns { ok: true, demo? } | { ok: false, reason }. Async — verifies on the server.
export async function adminLogin(pin) {
  try {
    const res  = await fetch(`${FUNCTIONS}/admin-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.token) {
      localStorage.setItem(ADMIN_AUTH_KEY, data.token);
      localStorage.setItem(ADMIN_EXP_KEY, String(data.exp || Date.now() + EIGHT_H));
      return { ok: true, demo: !!data.demo };
    }
    if (res.status === 401) return { ok: false, reason: (data && data.error) || "Incorrect PIN." };
    // Any other status (function missing / non-JSON) → fall through to dev fallback.
  } catch {
    // Network/proxy error (e.g. plain `npm run dev` without netlify dev) → dev fallback.
  }
  // DEV-ONLY fallback: usable only when the server is unreachable. A configured server
  // PIN returns 401 above (handled before here), so this never bypasses a real PIN.
  if (pin === DEMO_PIN) {
    const exp = Date.now() + EIGHT_H;
    localStorage.setItem(ADMIN_AUTH_KEY, `local.${exp}`);
    localStorage.setItem(ADMIN_EXP_KEY, String(exp));
    return { ok: true, demo: true };
  }
  return { ok: false, reason: "Incorrect PIN." };
}

export function adminLogout() {
  localStorage.removeItem(ADMIN_AUTH_KEY);
  localStorage.removeItem(ADMIN_EXP_KEY);
}

// ── Failed-attempt lockout (client-side UX; server adds a fixed delay too) ───────
export function getAdminLock() {
  const v = ls(ADMIN_LOCK_KEY);
  if (!v) return { locked: false, attempts: 0, until: 0 };
  if (v.until && Date.now() < v.until) return { locked: true, attempts: v.attempts || 0, until: v.until };
  if (v.until && Date.now() >= v.until) { localStorage.removeItem(ADMIN_LOCK_KEY); return { locked: false, attempts: 0, until: 0 }; }
  return { locked: false, attempts: v.attempts || 0, until: 0 };
}

// Records a failed attempt; locks for ADMIN_LOCK_MS once MAX is hit. Returns new state.
export function recordAdminFailure() {
  const cur = getAdminLock();
  const attempts = (cur.attempts || 0) + 1;
  const until = attempts >= ADMIN_MAX_ATTEMPTS ? Date.now() + ADMIN_LOCK_MS : 0;
  lsSet(ADMIN_LOCK_KEY, { attempts: until ? 0 : attempts, until });
  return { locked: !!until, attempts, until };
}

export function clearAdminFailures() { localStorage.removeItem(ADMIN_LOCK_KEY); }

// ── Coupons ───────────────────────────────────────────────────────────────────
function seedCoupons() {
  return [
    { id: "c1", code: "LAUNCH20",  type: "percent", value: 20, maxUses: 100, uses: 0, planId: null, expiresAt: "2026-09-14", active: true, createdAt: "2026-06-14" },
    { id: "c2", code: "INDIE10",   type: "percent", value: 10, maxUses: 50,  uses: 12, planId: "select", expiresAt: "2026-09-30", active: true, createdAt: "2026-03-15" },
    { id: "c3", code: "BONUS50EX", type: "extractions", value: 50, maxUses: 200, uses: 87, planId: null, expiresAt: null, active: true, createdAt: "2026-02-01" },
    { id: "c4", code: "EARLYBIRD", type: "percent", value: 30, maxUses: 30,  uses: 30, planId: null, expiresAt: "2026-04-01", active: false, createdAt: "2025-12-01" },
  ];
}

export function getCoupons() {
  const saved = ls(COUPONS_KEY);
  if (!saved) { const s = seedCoupons(); lsSet(COUPONS_KEY, s); return s; }
  return saved;
}

export function saveCoupon(coupon) {
  const coupons = getCoupons();
  const idx = coupon.id != null ? coupons.findIndex((c) => c.id === coupon.id) : -1;
  if (idx >= 0) {
    // Edit: merge so the new code/value/expiry are saved while uses + createdAt are preserved.
    coupons[idx] = { ...coupons[idx], ...coupon };
  } else {
    coupons.push({ id: `c${Date.now()}`, uses: 0, createdAt: new Date().toISOString().slice(0, 10), ...coupon });
  }
  lsSet(COUPONS_KEY, coupons);
  return coupons;
}

export function deleteCoupon(id) {
  const coupons = getCoupons().filter((c) => c.id !== id);
  lsSet(COUPONS_KEY, coupons);
  return coupons;
}

/**
 * @param {string} code
 * @param {string} currentPlanId
 * @param {object} [opts]
 * @param {boolean} [opts.allowManual] - Bypasses the "admin assignment only"
 *   rejection for a `planId === "manual"` coupon. Callers must only set this
 *   when the caller has already confirmed the code was assigned to THIS
 *   signed-in user (see BillingProvider.applyCoupon) — never for free-text
 *   entry, so a discovered/shared manual code still can't be self-applied by
 *   anyone else.
 * @param {string} [opts.assignedPlanId] - When bypassing the manual check,
 *   the plan this specific assignment is restricted to (or null/unset for
 *   "any plan"). A manual coupon's own `planId` field is the "manual"
 *   sentinel, not a real plan id, so the plan restriction for an assigned
 *   coupon comes from the per-assignment value here instead.
 */
export function validateCoupon(code, currentPlanId, opts = {}) {
  const now = new Date();
  const coupon = getCoupons().find((c) => c.code.toUpperCase() === code.toUpperCase());
  if (!coupon) return { valid: false, reason: "Coupon code not found." };
  if (!coupon.active) return { valid: false, reason: "This coupon has been deactivated." };
  const isManual = coupon.planId === "manual";
  if (isManual && !opts.allowManual) {
    return { valid: false, reason: "This coupon is for admin assignment only and cannot be self-applied." };
  }
  if (coupon.maxUses && coupon.uses >= coupon.maxUses) return { valid: false, reason: "Coupon has reached its usage limit." };
  if (coupon.expiresAt && new Date(coupon.expiresAt) < now) return { valid: false, reason: "This coupon has expired." };
  const restrictTo = isManual ? (opts.assignedPlanId || null) : coupon.planId;
  if (restrictTo && currentPlanId && restrictTo !== currentPlanId) {
    const planLabel = restrictTo.charAt(0).toUpperCase() + restrictTo.slice(1);
    return { valid: false, reason: `This coupon is only valid for the ${planLabel} plan.` };
  }
  return { valid: true, coupon };
}

/**
 * Reduce the full local coupon list (id/type/uses/createdAt and all) down to
 * the checkout-relevant subset admin-coupons-config.js expects: percent-type,
 * non-manual coupons only, keyed by code. See that function's header comment
 * for why "extractions" coupons and planId:"manual" coupons are excluded —
 * neither is ever redeemed through checkout.
 */
export function buildCouponsSyncPayload(coupons = getCoupons()) {
  const out = {};
  for (const c of coupons) {
    if (c.type !== "percent" || c.planId === "manual" || !c.code) continue;
    out[String(c.code).toUpperCase()] = {
      value: c.value, planId: c.planId || null, expiresAt: c.expiresAt || null,
      active: c.active !== false, maxUses: c.maxUses || 0,
    };
  }
  return out;
}

/**
 * Real server-side coupon status check — see netlify/functions/validate-coupon.js.
 * Used by BillingProvider.applyCoupon() so "Apply" can report an accurate
 * exhausted/expired/active verdict instead of the purely local, per-browser
 * check below (which has no way to see real usage from other sessions).
 *
 * Returns `{ found, active, expired, exhausted, planId, type, value }` for a
 * coupon the server recognizes, or `null` when the server doesn't have this
 * code (fall back to `validateCoupon` below — covers extraction-bonus and
 * manual-assign coupons, which are deliberately local-only) or the request
 * itself failed (network/offline — same fallback, consistent with this
 * codebase's fail-open-on-infra posture; the real money gate at checkout is
 * unaffected either way).
 */
export async function checkCouponServer(code) {
  try {
    const res = await fetch(`${FUNCTIONS}/validate-coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || !data.found) return null;
    return data;
  } catch {
    return null;
  }
}

export function incrementCouponUses(code) {
  const coupons = getCoupons();
  const coupon = coupons.find((c) => c.code.toUpperCase() === code.toUpperCase());
  if (coupon) { coupon.uses += 1; lsSet(COUPONS_KEY, coupons); }
}

// ── Users ─────────────────────────────────────────────────────────────────────
function seedUsers() {
  const plans = ["free", "select", "pro", "business", "agency", "free", "pro", "select", "free", "pro"];
  const sources = ["organic", "referral", "linkedin", "google", "product-hunt", "twitter", "direct", "organic", "linkedin", "google"];
  const names = ["Priya Sharma", "Alex Chen", "Maria Garcia", "James O'Brien", "Yuki Tanaka",
                 "Anouk de Vries", "Carlos Lima", "Ngozi Adeyemi", "Sven Larsson", "Amara Diallo"];
  return names.map((name, i) => ({
    id: `u${i + 1}`,
    name,
    email: name.toLowerCase().replace(/['\s]+/g, ".") + "@example.com",
    planId: plans[i],
    bonusExtractions: i % 3 === 0 ? 50 : 0,
    source: sources[i],
    joinedAt: new Date(Date.now() - (30 - i * 2) * 86400000).toISOString().slice(0, 10),
    extractionsThisMonth: Math.floor(Math.random() * 80),
    lastActive: new Date(Date.now() - i * 3 * 86400000).toISOString().slice(0, 10),
    inviteSent: i % 4 === 0,
  }));
}

export function getAdminUsers() {
  const saved = ls(ADMIN_USERS_KEY);
  if (!saved) { const s = seedUsers(); lsSet(ADMIN_USERS_KEY, s); return s; }
  return saved;
}

export function updateAdminUser(user) {
  const users = getAdminUsers().map((u) => (u.id === user.id ? user : u));
  lsSet(ADMIN_USERS_KEY, users);
  return users;
}

export function addAdminUser(user) {
  const users = getAdminUsers();
  users.push({ id: `u${Date.now()}`, joinedAt: new Date().toISOString().slice(0, 10), extractionsThisMonth: 0, lastActive: new Date().toISOString().slice(0, 10), inviteSent: true, ...user });
  lsSet(ADMIN_USERS_KEY, users);
  return users;
}

// ── Revenue metrics ───────────────────────────────────────────────────────────
// Reads pricing overrides directly from localStorage to avoid circular imports.
function getEffectivePlanPrices() {
  const BASE = { free: 0, select: 19, pro: 29, business: 79, agency: 199 };
  try {
    const overrides = JSON.parse(localStorage.getItem("datiq.pricingOverrides") || "{}");
    for (const [id, ov] of Object.entries(overrides)) {
      if (ov?.price_usd !== undefined) BASE[id] = Number(ov.price_usd) || 0;
    }
  } catch {}
  return BASE;
}

export function getRevenueMetrics() {
  const users = getAdminUsers();
  const planPrices = getEffectivePlanPrices();

  const byPlan = { free: 0, select: 0, pro: 0, business: 0, agency: 0 };
  let mrr = 0;
  users.forEach((u) => {
    byPlan[u.planId] = (byPlan[u.planId] ?? 0) + 1;
    mrr += planPrices[u.planId] ?? 0;
  });
  const paying = users.filter((u) => u.planId !== "free").length;
  return {
    mrr,
    arr: mrr * 12,
    totalUsers: users.length,
    payingUsers: paying,
    freeUsers: users.length - paying,
    byPlan,
    newThisMonth: users.filter((u) => {
      const joined = new Date(u.joinedAt);
      const now = new Date();
      return joined.getMonth() === now.getMonth() && joined.getFullYear() === now.getFullYear();
    }).length,
    couponUsage: getCoupons().reduce((s, c) => s + c.uses, 0),
  };
}

// Monthly revenue trend (last 6 months, simulated growth from current MRR)
export function getRevenueTrend() {
  const base = getRevenueMetrics().mrr;
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const label = d.toLocaleString("default", { month: "short", year: "2-digit" });
    const factor = 0.62 + i * 0.076;
    return { label, mrr: Math.round(base * factor) };
  });
}
