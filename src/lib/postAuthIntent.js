// postAuthIntent.js — where a user was when they chose to sign in, and what
// should happen once they have.
//
// The rule is TASK FIRST, PERSONA SECOND. Someone who signed in because a gate
// stopped them mid-task (saving an extraction, running an audit, accepting an
// invite) goes straight back to that task, and is offered the role choice as a
// dismissible card on the page. Someone who signed up from the front door
// (Home, pricing, a marketing page) goes to /onboarding.
//
// sessionStorage, like pendingSchedule / pendingAudit, because OAuth navigates
// the whole document away and back and in-memory state does not survive it.
import { getPendingAudit } from "./pendingAudit.js";
import { peekPendingSchedule } from "./pendingSchedule.js";
import { getPendingWorkspaceInvite } from "./pendingWorkspaceInvite.js";
import { getPendingReferral } from "./referralService.js";

const KEY = "datiq.postAuthIntent";
// A stash older than this was abandoned (the user closed the modal and wandered
// off); honouring it later would redirect somebody out of nowhere.
const MAX_AGE_MS = 30 * 60 * 1000;

// App surfaces where a user is doing something. Signing in from one of these is
// a mid-task sign-in; everything else is the front door.
const TASK_PREFIXES = [
  "/preview", "/batch", "/discoverability", "/schedules", "/dashboard",
  "/workspace", "/templates", "/lists", "/watchlists", "/rules", "/workflows",
  "/engagement", "/account", "/payment", "/p/", "/reset-password",
];

// Use-case landing pages that clearly belong to one role. Signing up from one
// pre-selects that role on /onboarding (the user still confirms it).
const USE_CASE_ROLE = {
  "lead-generation": "sales",
  "account-intelligence": "sales",
  "revops": "revops",
  "competitor-research": "competitive-intel",
  "competitive-monitoring": "competitive-intel",
  "product-marketing": "pmm",
  "seo-audit": "seo",
  "ai-visibility": "seo",
  "brand-cro": "brand-growth",
  "market-research": "founder-vc",
  "investor-diligence": "founder-vc",
};

/** Paths that must never be interrupted by the onboarding redirect or card. */
export const ONBOARDING_EXEMPT_PREFIXES = ["/onboarding", "/admin", "/payment", "/p/", "/reset-password"];

// "/p/" matches "/p/abc" only; "/batch" matches "/batch" and "/batch/x", never "/batchy".
function underPrefix(pathname, prefix) {
  if (prefix.endsWith("/")) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export function isOnboardingExempt(pathname = "") {
  return ONBOARDING_EXEMPT_PREFIXES.some((p) => underPrefix(pathname, p));
}

export function setPostAuthIntent(returnTo) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ returnTo: returnTo || "/", at: Date.now() }));
  } catch { /* storage unavailable — the fallbacks below still work */ }
}

export function peekPostAuthIntent(now = Date.now()) {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v.returnTo !== "string" || now - (v.at || 0) > MAX_AGE_MS) return null;
    return v;
  } catch { return null; }
}

export function clearPostAuthIntent() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

function hasPendingTask() {
  try {
    return Boolean(getPendingAudit() || peekPendingSchedule() || getPendingWorkspaceInvite() || getPendingReferral());
  } catch { return false; }
}

/** Only same-origin app paths are ever used as a redirect target. */
export function safeNext(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

/**
 * Decide what a fresh sign-in should do.
 * @returns {{ kind: "task"|"plain", returnTo: string, role: string|null }}
 */
export function classifyPostAuth(returnTo = "/", { pendingTask = hasPendingTask() } = {}) {
  const path = safeNext(returnTo) || "/";
  const pathname = path.split(/[?#]/)[0];
  const ucMatch = pathname.match(/^\/use-cases\/([^/]+)\/?$/);
  const role = ucMatch ? USE_CASE_ROLE[ucMatch[1]] || null : null;
  const onTask = TASK_PREFIXES.some((p) => underPrefix(pathname, p));
  return { kind: onTask || pendingTask ? "task" : "plain", returnTo: path, role };
}

/** The /onboarding URL for a given reason, carrying where to go afterwards. */
export function onboardingUrl({ next, role, mode } = {}) {
  const q = new URLSearchParams();
  if (mode) q.set("mode", mode);
  const n = safeNext(next);
  if (n && n !== "/" && !n.startsWith("/onboarding")) q.set("next", n);
  if (role) q.set("role", role);
  const s = q.toString();
  return "/onboarding" + (s ? `?${s}` : "");
}

// ── The "Personalise DatIQ" card's dismissal ─────────────────────────────────
// Dismissed for the rest of the session each time; after two dismissals it is
// gone for good. "Switch persona" in the account menu stays available always.
const NUDGE_COUNT_KEY = "datiq.personaNudgeDismissals";
const NUDGE_SESSION_KEY = "datiq.personaNudgeHidden";
export const NUDGE_MAX_DISMISSALS = 2;

export function isNudgeDismissed() {
  try {
    if (sessionStorage.getItem(NUDGE_SESSION_KEY) === "1") return true;
    return Number(localStorage.getItem(NUDGE_COUNT_KEY) || 0) >= NUDGE_MAX_DISMISSALS;
  } catch { return false; }
}

export function dismissNudge() {
  try {
    sessionStorage.setItem(NUDGE_SESSION_KEY, "1");
    const n = Number(localStorage.getItem(NUDGE_COUNT_KEY) || 0) + 1;
    localStorage.setItem(NUDGE_COUNT_KEY, String(n));
  } catch { /* ignore */ }
}
