// adminService.js — V5 admin module: coupons, user management, revenue metrics.
// All data is localStorage-persisted (production would use Supabase + server).

const COUPONS_KEY = "scrapelite.coupons";
const ADMIN_USERS_KEY = "scrapelite.adminUsers";
const ADMIN_AUTH_KEY  = "scrapelite.adminAuth";

const ADMIN_PIN = "ADMIN123"; // demo PIN — in production, use Supabase Auth + role

function ls(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function lsSet(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ── Auth ──────────────────────────────────────────────────────────────────────
export function isAdminAuthed() {
  return ls(ADMIN_AUTH_KEY) === true || localStorage.getItem(ADMIN_AUTH_KEY) === "true";
}
export function adminLogin(pin) {
  if (pin === ADMIN_PIN) { lsSet(ADMIN_AUTH_KEY, true); return true; }
  return false;
}
export function adminLogout() { localStorage.removeItem(ADMIN_AUTH_KEY); }

// ── Coupons ───────────────────────────────────────────────────────────────────
function seedCoupons() {
  return [
    { id: "c1", code: "LAUNCH20",  type: "percent", value: 20, maxUses: 100, uses: 34, planId: null, expiresAt: "2026-12-31", active: true, createdAt: "2026-01-01" },
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
  const idx = coupons.findIndex((c) => c.id === coupon.id);
  if (idx >= 0) coupons[idx] = coupon;
  else coupons.push({ id: `c${Date.now()}`, uses: 0, createdAt: new Date().toISOString().slice(0, 10), ...coupon });
  lsSet(COUPONS_KEY, coupons);
  return coupons;
}

export function deleteCoupon(id) {
  const coupons = getCoupons().filter((c) => c.id !== id);
  lsSet(COUPONS_KEY, coupons);
  return coupons;
}

export function validateCoupon(code) {
  const now = new Date();
  const coupon = getCoupons().find((c) => c.code.toUpperCase() === code.toUpperCase());
  if (!coupon) return { valid: false, reason: "Coupon code not found." };
  if (!coupon.active) return { valid: false, reason: "This coupon has been deactivated." };
  if (coupon.maxUses && coupon.uses >= coupon.maxUses) return { valid: false, reason: "Coupon has reached its usage limit." };
  if (coupon.expiresAt && new Date(coupon.expiresAt) < now) return { valid: false, reason: "This coupon has expired." };
  return { valid: true, coupon };
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
const PLAN_PRICES = { free: 0, select: 19, pro: 29, business: 79, agency: 199 };

export function getRevenueMetrics() {
  const users = getAdminUsers();
  const byPlan = { free: 0, select: 0, pro: 0, business: 0, agency: 0 };
  let mrr = 0;
  users.forEach((u) => {
    byPlan[u.planId] = (byPlan[u.planId] ?? 0) + 1;
    mrr += PLAN_PRICES[u.planId] ?? 0;
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

// Monthly revenue trend (last 6 months, simulated growth)
export function getRevenueTrend() {
  const base = getRevenueMetrics().mrr;
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const label = d.toLocaleString("default", { month: "short", year: "2-digit" });
    const factor = 0.62 + i * 0.076 + (i === 5 ? 0 : 0);
    return { label, mrr: Math.round(base * factor) };
  });
}
