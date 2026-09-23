// creditClient.js — cached read of the user's credit position.
//
// ⚠️ THIS CACHE IS UX ONLY, exactly as entitlementClient.js is. It exists so a
// balance can be painted without a round-trip per click. It is NOT
// authorization: every charge re-sums the ledger server-side at the moment it
// spends, because a balance the browser holds is a number the user can edit.
//
// TTL matches entitlementClient's 60s, so the two hints drift for at most the
// same window and a screen showing both cannot contradict itself.

import { apiClient } from "../apiClient.js";

const CACHE_KEY = "datiq.credits";
export const TTL_MS = 60_000;

let memory = null;   // { status, fetchedAt }
let inflight = null;

function readPersisted() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (raw && typeof raw.fetchedAt === "number") return raw;
  } catch { /* private mode — memory cache still works */ }
  return null;
}

function persist(entry) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry)); }
  catch { /* quota / private mode */ }
}

function fresh(entry, now) {
  return Boolean(entry) && now - entry.fetchedAt < TTL_MS;
}

/**
 * 🔴 THE SHAPE EVERY CALLER MUST BRANCH ON.
 *
 *   enforced: false   this account is not on the credit system — either it is
 *                     a guest, or it has never been granted credits. Show
 *                     NOTHING. Rendering "0 credits remaining" here tells a
 *                     customer they are out of something they were never
 *                     given, which is worse than showing no number at all.
 *   degraded: true    we could not read it. Also show nothing — "we do not
 *                     know" must never render as a confident zero, which is
 *                     the same distinction the audit scorer draws between an
 *                     unmeasured signal and one that scored zero.
 *   enforced: true    `available` is a real number and may be shown.
 */
export const EMPTY = Object.freeze({
  enforced: false, degraded: false, available: null, grants: 0,
});

/** Synchronous best-effort read. Returns null when nothing is cached yet. */
export function getCachedCredits() {
  if (memory) return memory.status;
  const persisted = readPersisted();
  if (persisted) {
    memory = persisted;
    return persisted.status;
  }
  return null;
}

/** Fetch the balance, coalescing concurrent callers onto one request. */
export async function fetchCredits({ force = false, now = Date.now() } = {}) {
  if (!force) {
    const cached = memory || readPersisted();
    if (fresh(cached, now)) {
      memory = cached;
      return cached.status;
    }
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const status = await apiClient.credits();
      const entry = { status: { ...EMPTY, ...status }, fetchedAt: now };
      memory = entry;
      persist(entry);
      return entry.status;
    } catch {
      // ⚠️ A failed read is DEGRADED, never empty. Returning EMPTY with
      // enforced:false would be indistinguishable from "not on the credit
      // system", and the UI would silently stop showing a balance the
      // customer does have.
      return { ...EMPTY, degraded: true };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Drop the cache. Call on sign-in, sign-out, and after anything that spends. */
export function clearCreditsCache() {
  memory = null;
  inflight = null;
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

/** Human copy for a balance line. Returns null when there is nothing to say. */
export function describeCredits(status) {
  if (!status || status.degraded || !status.enforced) return null;
  const n = Number(status.available);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return "No credits remaining";
  return `${n.toLocaleString()} credit${n === 1 ? "" : "s"} remaining`;
}
