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
//     is responsible for the content they scrape.
//
// This module decides ONLY what robots.txt says. It does not know about the
// signed-in user's recorded attestation ("I have permission to scrape this
// site") — that override lives in lib/scrapeConsent.js and is applied by the
// caller, so a refusal here stays a pure reading of the host's own rules.
//
// A NOTE ON MAP MODE. The header used to claim map mode was exempt from this
// check. It never was: extract.js runs checkCompliance before it branches on
// options.mapMode, so map mode has always been enforced. Enforcement is the
// behaviour we want — a crawl that enumerates a whole site is the LAST thing
// that should ignore robots.txt — so the comment was the wrong half, and this
// is it corrected rather than the code loosened to match it.
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
  // Match on the PRODUCT TOKEN ("datiqbot"), not the full "datiqbot/1.0".
  // The old test was `uaLower.startsWith(agent)`, which meant a robots.txt
  // block addressed to `User-agent: D` — or any other prefix of our name —
  // captured us and silently replaced the `*` rules we should have obeyed.
  // Per RFC 9309 the record matches when its value equals our product token,
  // case-insensitively; we additionally accept the token with a version
  // suffix so `DatIQBot/1.0` in a robots file still finds us.
  const uaLower = ua.toLowerCase();
  const token = uaLower.split("/")[0];
  const matches = (a) => {
    const agent = String(a).toLowerCase().trim();
    return agent === token || agent === uaLower || agent.split("/")[0] === token;
  };
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

// ── Public: multi-agent robots evaluation (discoverability audits) ──────────
//
// The audit engine needs a different question answered than extract.js does.
// extract.js asks "may WE fetch this?" for one UA. An audit asks "which of the
// twelve answer-engine crawlers may fetch this?", because uneven access is
// itself a finding (issue TA-02).
//
// ⚠️ This deliberately does NOT go through loadRobots(). That function caches
// by HOST while storing rules parsed for ONE user-agent, so calling it twelve
// times with twelve agents would leave the extract path's cache holding
// whichever agent happened to run last — silently answering "may DatIQBot
// fetch this?" with GPTBot's rules. A separate raw-text cache keeps the two
// questions apart while still using the SAME parser, so the RFC 9309
// product-token matching fixed in parseRobots can never drift between them.

const robotsTextCache = new Map();
const ROBOTS_TEXT_TTL_MS = 10 * 60_000;

export function _resetRobotsTextCacheForTests() {
  robotsTextCache.clear();
}

/**
 * Fetch a host's robots.txt as raw text.
 *
 * @returns {Promise<{ text: string|null, status: number|null, error: string|null, fetched: boolean }>}
 *
 * `text: null` with no error means the host has no robots.txt, which is a
 * PERMISSIVE condition and must not be reported as a block. `error` set means
 * we could not find out — which is issue TA-16, "crawl policy is unknown",
 * and is reported as unknown rather than scored as a failure.
 */
export async function fetchRobotsText(origin, options = {}) {
  const host = hostOf(origin);
  if (!host) return { text: null, status: null, error: "invalid origin", fetched: false };

  const now = Date.now();
  const cached = robotsTextCache.get(host);
  if (cached && cached.expiresAt > now) return { ...cached.value, fetched: false };

  const robotsUrl = `${origin.replace(/\/$/, "")}/robots.txt`;
  let value;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), options.timeoutMs || ROBOTS_TIMEOUT_MS);
    const res = await fetchPublicUrl(robotsUrl, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.status === 404 || res.status === 410) {
      // No robots.txt at all. Everything is permitted — the honest reading.
      value = { text: null, status: res.status, error: null };
    } else if (!res.ok) {
      value = { text: null, status: res.status, error: `http ${res.status}` };
    } else {
      value = { text: await res.text(), status: res.status, error: null };
    }
  } catch (err) {
    value = { text: null, status: null, error: err?.message || "fetch failed" };
  }

  robotsTextCache.set(host, { value, expiresAt: now + ROBOTS_TEXT_TTL_MS });
  return { ...value, fetched: true };
}

/**
 * Evaluate one robots.txt against several user-agents at once.
 *
 * @param {string|null} robotsText  raw file, or null when the host serves none
 * @param {string[]} agents         product tokens, e.g. ["GPTBot","ClaudeBot"]
 * @param {string} path             pathname (+search) being audited
 * @returns {Record<string, boolean|null>} agent → allowed. `null` means the
 *          policy could not be read, which the audit reports as unknown rather
 *          than scoring as a block — the same "not checked is never down" rule
 *          the ops dashboard follows.
 */
export function evaluateAgentAccess(robotsText, agents = [], path = "/") {
  const out = {};
  for (const agent of agents) {
    if (robotsText === null || robotsText === undefined) {
      // No robots.txt is PERMISSIVE. An unreadable one is UNKNOWN. The caller
      // distinguishes them by whether fetchRobotsText reported an error.
      out[agent] = true;
      continue;
    }
    try {
      const parsed = parseRobots(robotsText, agent);
      out[agent] = isPathAllowed(parsed.rules, path);
    } catch {
      out[agent] = null;
    }
  }
  return out;
}

// ── Public: top-level check used by extract.js ───────────────────────────────
/**
 * Check whether scraping `url` with our UA is permitted by the host's
 * robots.txt. Returns:
 *   {
 *     allowed: boolean,
 *     reason: string,           — human-readable explanation
 *     crawlDelayMs: number,     — recommended delay before next request
 *     code: string,             — STABLE machine-readable verdict, see below
 *     host: string,             — the host the verdict is about
 *     path: string,             — pathname + search, echoed VERBATIM
 *   }
 *
 * `code` is the field callers should branch on. It exists because the only
 * thing distinguishing a deliberate policy refusal from a genuine fault used
 * to be the prose in `reason`, and the client's error classifier matched on
 * that prose — so a robots.txt refusal fell through every category and was
 * reported to the user as "Something went wrong. An unexpected error
 * occurred." Prose is for humans; branch on the code.
 *
 *   "allowed"            — scrape it
 *   "robots_disallowed"  — the host's own robots.txt says no. OVERRIDABLE by a
 *                          signed-in user's recorded attestation; see
 *                          lib/scrapeConsent.js. The caller applies that, not
 *                          this module.
 *   "host_not_permitted" — the operator's PERMITTED_HOSTS allowlist excludes
 *                          this host. NOT overridable by a user: it is the
 *                          operator's decision, not the site's.
 *   "invalid_url"        — unparseable.
 *
 * `reason` is unchanged, byte for byte, so anything still reading it keeps
 * working.
 */
export async function checkCompliance(url, opts = {}) {
  const ua = opts.ua || "DatIQBot/1.0";
  const explicitAllowlist = (opts.permittedHosts || "").split(",").map((s) => s.trim()).filter(Boolean);
  const host = hostOf(url);
  if (!host) {
    return { allowed: false, reason: "invalid URL", crawlDelayMs: 0, code: "invalid_url", host: "", path: "" };
  }

  if (explicitAllowlist.length > 0) {
    if (!explicitAllowlist.includes(host)) {
      return {
        allowed: false,
        reason: `Host ${host} is not on the operator-configured permitted-hosts list`,
        crawlDelayMs: 0,
        code: "host_not_permitted",
        host,
        path: "",
      };
    }
    // Operator explicitly listed this host — bypass robots.txt entirely
    // (e.g. closed-beta partners who've given written consent).
    return {
      allowed: true,
      reason: `Host ${host} is on the operator permitted-hosts list (bypassing robots.txt)`,
      crawlDelayMs: 0,
      code: "allowed",
      host,
      path: "",
    };
  }

  const origin = `${new URL(url).protocol}//${host}`;
  const robots = await loadRobots(origin, ua);
  // Echoed verbatim into `reason`. Never normalise or shorten it: the path in
  // the message is how anyone reading a support report knows WHICH url was
  // refused, and a rewritten path sends them looking for a bug that isn't there.
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
    code: allowed ? "allowed" : "robots_disallowed",
    host,
    path,
  };
}

export const _internal = { ROBOTS_TTL_MS, ROBOTS_TIMEOUT_MS, DEFAULT_CRAWL_DELAY_MS, ROBOTS_TEXT_TTL_MS, parseRobots, isPathAllowed };
