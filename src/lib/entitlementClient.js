// entitlementClient.js — cached read of the user's entitlement row.
//
// ⚠️ THIS CACHE IS UX ONLY. It exists so the UI can render gates without a
// network round-trip per click. It is NOT authorization. Every mutating
// endpoint re-resolves the entitlement server-side with the service key (see
// netlify/functions/lib/requireEntitlement.js). Treat anything read here as a
// hint that the user is free to tamper with — because they are.
//
// TTL mirrors the 60s server-side pricing cache in
// netlify/functions/lib/pricingSource.js, so the two layers drift for at most
// the same window.
import { fetchEntitlement } from "./billingRepo.js";

const CACHE_KEY = "datiq.entitlement";
export const TTL_MS = 60_000;

let memory = null; // { row, fetchedAt }
let inflight = null;

function readPersisted() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (raw && typeof raw.fetchedAt === "number") return raw;
  } catch {
    /* ignore */
  }
  return null;
}

function persist(entry) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* quota / private mode — memory cache still works */
  }
}

function fresh(entry, now) {
  return Boolean(entry) && now - entry.fetchedAt < TTL_MS;
}

/** Synchronous best-effort read. Returns null when nothing is cached yet. */
export function getCachedEntitlement() {
  if (memory) return memory.row;
  const persisted = readPersisted();
  if (persisted) {
    memory = persisted;
    return persisted.row;
  }
  return null;
}

/**
 * Read the entitlement, using the cache when fresh.
 * Concurrent callers share one in-flight request.
 *
 * @param {{force?: boolean, now?: number}} [opts]
 */
export async function loadEntitlement({ force = false, now = Date.now() } = {}) {
  if (!force) {
    if (fresh(memory, now)) return memory.row;
    const persisted = readPersisted();
    if (fresh(persisted, now)) {
      memory = persisted;
      return persisted.row;
    }
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const row = await fetchEntitlement();
      // Stamp with the SAME clock the freshness check uses. Mixing an injected
      // `now` with Date.now() here makes the two incomparable and the entry
      // effectively immortal.
      const entry = { row, fetchedAt: now };
      memory = entry;
      persist(entry);
      return row;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Drop the cache. Call on sign-in, sign-out, and after a successful payment —
 * the three moments where a stale entitlement is most visible to the user
 * (e.g. still seeing "renew" immediately after paying).
 */
export function clearEntitlementCache() {
  memory = null;
  inflight = null;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Bust the cache when a server response reports a newer entitlement version.
 * Cheap, self-healing staleness correction: any /api call can carry the header
 * and the next read picks up the change without waiting out the TTL.
 */
export function noteEntitlementVersion(version) {
  const v = Number(version);
  if (!Number.isFinite(v)) return;
  const current = memory?.row?.version;
  if (current != null && v > Number(current)) clearEntitlementCache();
}
