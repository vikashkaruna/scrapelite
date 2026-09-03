// templatesCache.js — localStorage prefetch for the workflow-template catalogue.
//
// WHY
// ---
// /templates is a public acquisition surface: it is often the first page a
// visitor sees, and it cannot paint anything until a Netlify Function has done
// a Supabase round trip. That is a cold spinner on the page whose whole job is
// to make the product look immediately useful.
//
// The pattern is the one Dashboard already uses: paint from localStorage
// instantly, revalidate against the server in the background, replace on a
// good answer. A browser refresh re-runs the revalidation, so a refresh is
// always a genuine reload from the database — the cache accelerates the first
// paint, it never becomes the source of truth.
//
// THE RULE THAT MAKES THIS SAFE
// -----------------------------
// A DEGRADED response is never cached, and never overwrites a good cache.
//
// When the template store is unreachable the endpoint answers 200 with the six
// built-in SEED templates and `degraded: true` (see netlify/functions/
// templates.js). Those are a legitimate fallback for RENDERING, but they are
// not the truth: a workspace with custom or newly published templates would
// have them silently replaced by the stock six, and — because we persist —
// that wrong list would then survive the outage and keep being served from
// localStorage after the store came back. This is the same failure Dashboard
// already learned the hard way, where a successful-but-empty server response
// was trusted as authoritative and wiped the local cache
// (see extractionsRepo.listExtractions).

const KEY = "datiq.templatesCache";

// Bump when the cached SHAPE changes. An old entry is then dropped rather than
// fed to code expecting new fields — cheaper and safer than migrating it.
const SHAPE_VERSION = 1;

// How long a cached list may be painted before we prefer a spinner. This is
// NOT how long it may be USED: we always revalidate, so the only question is
// whether showing a possibly-stale list beats showing nothing. A day is well
// past the point where that trade stops being obvious.
const MAX_PAINT_AGE_MS = 24 * 60 * 60 * 1000;

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * The cached catalogue, or null when there is nothing safe to paint.
 * Never throws — Safari private mode and disabled site data both make
 * localStorage access itself raise, and a caching layer must never be the
 * reason a page fails to render.
 */
export function readTemplatesCache(now = Date.now()) {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  const entry = safeParse(raw);
  if (!entry || entry.v !== SHAPE_VERSION) return null;
  if (!Array.isArray(entry.templates) || entry.templates.length === 0) return null;
  const age = now - Number(entry.cachedAt || 0);
  if (!Number.isFinite(age) || age < 0 || age > MAX_PAINT_AGE_MS) return null;
  return { templates: entry.templates, cachedAt: entry.cachedAt, ageMs: age };
}

/**
 * Persist a catalogue response.
 *
 * @param {{templates?: object[], degraded?: boolean}} response the raw
 *   `GET /api/templates` body. Passing the response rather than just the array
 *   is deliberate: the decision NOT to cache depends on `degraded`, and a
 *   caller that had to remember to check it would eventually forget.
 * @returns {boolean} whether anything was written — so a caller can tell
 *   "stored" from "deliberately skipped" instead of assuming success.
 */
export function writeTemplatesCache(response, now = Date.now()) {
  if (!response || response.degraded === true) return false;
  const templates = response.templates;
  if (!Array.isArray(templates) || templates.length === 0) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SHAPE_VERSION, cachedAt: now, templates }));
    return true;
  } catch {
    // Quota exceeded or storage disabled. The page already has the live list;
    // losing the accelerator is not worth surfacing to a user.
    return false;
  }
}

/** Drop the cache. Used when the shape changes under us or on sign-out. */
export function clearTemplatesCache() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
}

export const __testing = { KEY, SHAPE_VERSION, MAX_PAINT_AGE_MS };
