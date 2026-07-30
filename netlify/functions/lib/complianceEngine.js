// netlify/functions/lib/complianceEngine.js — FD3 (robots.txt + ToS compliance).
//
// Council intent: "Prevents shared-infra IP bans (one abusive user
// blackholes everyone); the compliance story enterprise buyers ask about
// first."
//
// What this module does:
//   1. Fetch + cache `robots.txt` per host (1h TTL, in-process).
//   2. Parse Allow / Disallow rules and check whether the given path is
//      permitted for our user agent ("DatIQBot/1.0").
//   3. Honor Crawl-delay (returned as a per-domain delay hint).
//   4. Apply an explicit "permitted hosts" allowlist when the operator
//      wants a closed beta.
//
// What this module does NOT do (and why):
//   - No ToS database. CFAA / ToS exposure is a legal risk; the operator
//     is responsible for the content they scrape. The function surfaces
//     a `requireConsent` flag in the response so the UI can show a
//     "I have permission to scrape this site" checkbox.
//   - No robots.txt enforcement for map mode. Map mode crawls within
//     a single site and the caller's intent is to enumerate, so we
//     intentionally skip the compliance check for that one code path.
//
// IMPORTANT: the robots.txt fetch is best-effort. If the fetch fails or
// the host doesn't serve one, we FAIL OPEN (allow scraping) — this is the
// standard practice. The DD3 commentary says "robots.txt compliance" but
// the only safe default is to permit; the caller is responsible for any
// site they scrape.

import { fetchPublicUrl } from "./publicUrl.js";

const ROBOTS_TTL_MS = 60 * 60 * 1000; // 1 hour
const ROBOTS_TIMEOUT_MS = 5_000;
const DEFAULT_CRAWL_DELAY_MS = 1000; // fallback when robots.txt has no Crawl-delay

// ── Per-host robots cache ────────────────────────────────────────────────────
const robotsCache = new Map(); // host → { rules, expiresAt, crawlDelayMs, error }

export function _resetRobotsCacheForTests() {
  robotsCache.clear();
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

// ── robots.txt parser (minimal) ──────────────────────────────────────────────
// Supports:
//   User-agent: *
//   Allow: /path
//   Disallow: /path
//   Crawl-delay: 5
//   Sitemap: https://...
//
// We always match as "DatIQBot/1.0" (our advertised UA). The standard
// behaviour: if a per-agent block matches our UA, use ONLY its rules;
// otherwise fall back to the * block.
function parseRobots(text, ua) {
  const lines = String(text || "").split(/\r?\n/);
  // Collect all blocks: array of { agents: string[], rules, crawlDelaySec }
  const blocks = [];
  let current = { agents: [], rules: [], crawlDelaySec: null };

  const commit = () => {
    if (current.agents.length > 0 || current.rules.length > 0 || current.crawlDelaySec != null) {
      blocks.push(current);
    }
    current = { agents: [], rules: [], crawlDelaySec: null };
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();

    if (key === "user-agent") {
      // A new agent declaration starts a new block (unless it's a second
      // declaration in the same block, which is allowed by the spec).
      if (current.rules.length > 0 || current.crawlDelaySec != null) {
        commit();
        current.agents.push(val.toLowerCase());
      } else {
        current.agents.push(val.toLowerCase());
      }
    } else if (key === "allow") {
      current.rules.push({ type: "allow", path: val });
    } else if (key === "disallow") {
      if (val) current.rules.push({ type: "disallow", path: val });
    } else if (key === "crawl-delay") {
      const n = parseFloat(val);
      if (!isNaN(n) && n > 0) current.crawlDelaySec = n;
    }
  }
  commit();

  // Pick the most specific block that matches our UA. If a per-agent
  // block (non-wildcard) matches, use ONLY that block. Otherwise fall
  // back to the * block.
  // Match: a block's agent is a prefix of our UA (case-insensitive).
  // "DatIQBot" matches UA "DatIQBot/1.0".
  const uaLower = ua.toLowerCase();
  const matches = (a) => uaLower.startsWith(a.toLowerCase()) || a.toLowerCase() === uaLower;
  const ourBlock = blocks.find((b) =>
    b.agents.some(matches) && !b.agents.includes("*"),
  );
  const wildBlock = blocks.find((b) => b.agents.includes("*"));
  const block = ourBlock || wildBlock;
  if (!block) return { rules: [], crawlDelaySec: null };
  return { rules: block.rules, crawlDelaySec: block.crawlDelaySec };
}

// Match a path against a rule. Wildcard `*` supported; `$` end-anchor.
function ruleMatches(rule, path) {
  const p = rule.path;
  if (!p) return false;
  // Convert glob to regex
  let re = "^";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") re += ".*";
    else if (c === "$" && i === p.length - 1) re += "$";
    else re += c.replace(/[.+?^=!:${}()|\[\]\/\\]/g, "\\$&");
  }
  try { return new RegExp(re).test(path); } catch { return false; }
}

export function isPathAllowed(rules, path) {
  // Longest match wins. If any allow matches before a disallow, allow.
  // The standard interpretation per Google's robots.txt spec.
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const r of rules || []) {
    if (ruleMatches(r, path)) {
      if (r.type === "allow" && r.path.length > bestAllow) bestAllow = r.path.length;
      if (r.type === "disallow" && r.path.length > bestDisallow) bestDisallow = r.path.length;
    }
  }
  return bestAllow >= bestDisallow;
}

// ── Public: fetch + parse + cache ────────────────────────────────────────────
export async function loadRobots(origin, ua = "DatIQBot/1.0", options = {}) {
  const host = hostOf(origin);
  if (!host) return null;
  const cached = robotsCache.get(host);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached;
  }
  const robotsUrl = `${origin.replace(/\/$/, "")}/robots.txt`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), options.timeoutMs || ROBOTS_TIMEOUT_MS);
    const res = await fetchPublicUrl(robotsUrl, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      // 404 / 5xx → no robots.txt → no rules
      const entry = { rules: [], crawlDelaySec: null, expiresAt: now + ROBOTS_TTL_MS, error: `http ${res.status}` };
      robotsCache.set(host, entry);
      return entry;
    }
    const text = await res.text();
    const parsed = parseRobots(text, ua);
    const entry = {
      rules: parsed.rules,
      crawlDelaySec: parsed.crawlDelaySec,
      expiresAt: now + ROBOTS_TTL_MS,
      error: null,
    };
    robotsCache.set(host, entry);
    return entry;
  } catch (err) {
    // Network error → fail open (allow) but cache the negative result for
    // a shorter window so we don't hammer a dead host.
    const entry = { rules: [], crawlDelaySec: null, expiresAt: now + 5 * 60_000, error: err.message };
    robotsCache.set(host, entry);
    return entry;
  }
}

// ── Public: top-level check used by extract.js ───────────────────────────────
/**
 * Check whether scraping `url` with our UA is permitted by the host's
 * robots.txt. Returns:
 *   {
 *     allowed: boolean,
 *     reason: string,           — human-readable explanation
 *     crawlDelayMs: number,     — recommended delay before next request
 *   }
 */
export async function checkCompliance(url, opts = {}) {
  const ua = opts.ua || "DatIQBot/1.0";
  const explicitAllowlist = (opts.permittedHosts || "").split(",").map((s) => s.trim()).filter(Boolean);
  const host = hostOf(url);
  if (!host) return { allowed: false, reason: "invalid URL", crawlDelayMs: 0 };

  if (explicitAllowlist.length > 0) {
    if (!explicitAllowlist.includes(host)) {
      return {
        allowed: false,
        reason: `Host ${host} is not on the operator-configured permitted-hosts list`,
        crawlDelayMs: 0,
      };
    }
    // Operator explicitly listed this host — bypass robots.txt entirely
    // (e.g. closed-beta partners who've given written consent).
    return {
      allowed: true,
      reason: `Host ${host} is on the operator permitted-hosts list (bypassing robots.txt)`,
      crawlDelayMs: 0,
    };
  }

  const origin = `${new URL(url).protocol}//${host}`;
  const robots = await loadRobots(origin, ua);
  const path = new URL(url).pathname + new URL(url).search;
  const allowed = isPathAllowed(robots?.rules || [], path);
  const crawlDelayMs = robots?.crawlDelaySec
    ? Math.max(0, Math.round(robots.crawlDelaySec * 1000))
    : DEFAULT_CRAWL_DELAY_MS;

  return {
    allowed,
    reason: allowed
      ? "robots.txt permits scraping for DatIQBot/1.0"
      : `robots.txt disallows scraping for DatIQBot/1.0 (path=${path})`,
    crawlDelayMs,
  };
}

export const _internal = { ROBOTS_TTL_MS, ROBOTS_TIMEOUT_MS, DEFAULT_CRAWL_DELAY_MS, parseRobots, isPathAllowed };
