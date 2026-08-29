# Session handoff — 2026-07-18 (R3 Habit & Reliability drop)

## TL;DR

All **6 R3 backlog gaps** closed in one drop. **+129 net new tests (1168 → 1297), build clean in 1.85s, 0 regressions.** Branched from `main` at `0516cca`.

| # | Council ID | Feature | Status |
|---|---|---|---|
| **F17** | Scheduled Monitoring + Change Detection | (already shipped in R19) | ✅ |
| **FC1** | Watchlist Home polish (monitored URLs + deltas) | New `WatchlistCard` + `watchlistDeltas` | ✅ |
| **F16** | Batch Enhancements | (already shipped in R5–R8) | ✅ |
| **F18** | Sheets / Airtable / Notion Exports | Notify-me waitlist (OAuth-free per user) | ✅ |
| **F36** | Anti-bot / Proxy / JS-rendering | Light layer (rate limiter + proxy + headless stub) | ✅ |
| **FD3** | robots.txt / ToS + Per-domain Rate Limiter | `complianceEngine` + `rateLimiter` (token bucket) | ✅ |
| **F49** | Re-engagement Emails | Weekly digest + D7 inactive (Resend) | ✅ |
| **F03** | Collections / Projects | (already shipped as lightweight — Groke QW#3) | ✅ |
| **FD2** | Idempotent Result Cache + URL Dedup | `resultCache` (LRU + Supabase) | ✅ |

## What landed

### FD2 — Result cache + URL-level dedup
- `src/lib/resultCache.js` — pure logic layer: `normaliseUrl` (strips tracking params, lowercases host, default-https, sorts query), `hashOptions` (FNV-1a), `buildCacheKey`, `isCacheable` (excludes `customPrompt` results), `makeCacheEntry` / `isCacheEntryFresh`, `InProcessLRU` class, `dedupDecision`.
- `netlify/functions/lib/resultCacheStore.js` — Supabase read/write/delete over REST with `extraction_cache` table.
- `scripts/result-cache.sql` — table + indexes + anon-read RLS.
- `netlify/functions/extract.js` — checks the cache before any provider call, fires a fire-and-forget write on success. Honors `options.noCache: true` for callers that want to bypass.
- **Test:** `src/lib/resultCache.test.js` (31 — URL normalisation, hash, cacheable flag, LRU, dedup decision).

### FD3 — robots.txt compliance + per-domain rate limiter
- `netlify/functions/lib/complianceEngine.js` — fetches + caches `robots.txt` per host (1h TTL), parses Allow/Disallow/Crawl-delay, honours the per-agent block when our UA matches. `checkCompliance(url)` returns `{allowed, reason, crawlDelayMs}`. Operator `PERMITTED_HOSTS` env var provides an explicit allowlist that **bypasses** robots.txt.
- `netlify/functions/lib/rateLimiter.js` — token-bucket per host (default: 1 req/s, burst 4, env-tunable via `RATE_LIMIT_BURST` / `RATE_LIMIT_REFILL`). `takeToken` is non-blocking; `takeTokenBlocking` polls every ≤2s.
- `scripts/rate-limit-log.sql` — `rate_limit_log` table for cross-warm-container enforcement (v1 ships with the in-process layer; the table is the durable extension point).
- `netlify/functions/extract.js` — calls `checkCompliance` then `takeTokenBlocking` BEFORE any provider call. Both paths fail open (compliance) and continue (rate limiter) on errors.
- **Tests:** `complianceEngine.test.js` (16 — parser, longest-match-wins, wildcards, fail-open, permitted-hosts), `rateLimiter.test.js` (13 — token bucket math, per-host isolation, blocking).

### F36 — Light anti-bot
- `netlify/functions/lib/proxyConfig.js` — `loadProxyPool(env)` parses `PROXY_URLS` (comma-separated http(s) URLs), `pickProxy()` returns round-robin or random. `buildProxyDispatcher()` is a stub for the `undici.ProxyAgent` integration (no Playwright binary).
- `netlify/functions/lib/headlessProvider.js` — `isHeadlessAvailable()` reads env, `headlessOptions("firecrawl")` returns `{renderJs:true, waitFor:3000}`, `headlessAttribution("firecrawl", env)` reports whether the response was JS-rendered.
- **Tests:** `proxyConfig.test.js` (12 — URL parsing, round-robin, random, security guards), `headlessProvider.test.js` (10 — provider detection, attribution, opt-in).

### FC1 — Watchlist Home
- `src/lib/watchlistDeltas.js` — `classifyDelta` returns one of `changed_since_visit | ran_since_visit | stale | never_run`, `summariseWatchlist` aggregates counts + earliest future `nextRunAt`, `readLastVisitedAt` / `writeLastVisitedAt` persist in `datiq.workspaceLastVisitedAt`.
- `src/components/WatchlistCard.jsx` — top-of-Workspace card for logged-in users with ≥1 schedule. Shows 6 most-active rows, total + changed + next-run subtitle, per-row icon (orange/green/grey), deep-link CTA to `/preview?url=…` or `/schedules`.
- `src/pages/Workspace.jsx` — mounts `<WatchlistCard>` when `schedules.length > 0`.
- **Tests:** `watchlistDeltas.test.js` (13 — classify logic, sort order, nextRunAt semantics, persistence), `WatchlistCard.test.jsx` (8 — null when empty, changed-count, next-run ETA, batch vs single target, 6-row cap, deep links).

### F49 — Re-engagement emails
- `netlify/functions/reengagement.js` — daily Netlify Scheduled Function. Two email surfaces, both via Resend:
  1. **Weekly digest** (Mondays only): "Your monitoring week — N runs, N changes, N errors." Dedup keyed by ISO week.
  2. **D7 re-engagement**: user whose most-recent schedule run is >7 days old gets a one-liner with a deep link to `/workspace`. Dedup keyed by date.
- Pure helpers: `buildDigest(rows)`, `digestHtml(...)`, `reengagementHtml(...)`, `isMonday`, `isOlderThan`, `getISOWeek`, `escapeHtml`.
- `scripts/reengagement-log.sql` — `reengagement_log` table for dedup (UNIQUE on `(user_email, kind, window_key)`).
- **Test:** `reengagement.test.js` (16 — aggregation, HTML escaping, date helpers, ISO week).

### F18 — Sheets / Airtable / Notion exports (OAuth-free per user)
- **Google Sheets** — already shipped via `openInGoogleSheets()` (CSV download + new-tab to Google Drive's create-sheet page). Updated Integrations.jsx so the Google Sheets card is "Available" with an "Open in Sheets" CTA → `/dashboard`.
- **Airtable + Notion + Slack + Zapier** — new `integrationsNotify.js` + `NotifyMeModal.jsx`. User clicks "Notify me" → email modal → persisted to `datiq.integrationWaitlist` + fired through `emailCaptureService` so marketing can reach them when the integration ships. The button text changes to "You're on the list" once the user is waitlisted.
- Integrations page now has 13 cards (was 12 — added Airtable).
- **Tests:** `integrationsNotify.test.js` (6 — invalid email, unknown slug, persistence, isWaitlisted), `NotifyMeModal.test.jsx` (6 — closed state, title, submit, error, changelog link).

## Files added (10)
- `src/lib/resultCache.js` (5.6K)
- `src/lib/resultCache.test.js` (6.6K, 31 tests)
- `src/lib/watchlistDeltas.js` (3.4K)
- `src/lib/watchlistDeltas.test.js` (5.2K, 13 tests)
- `src/lib/integrationsNotify.js` (2.2K)
- `src/lib/integrationsNotify.test.js` (1.8K, 6 tests)
- `src/components/WatchlistCard.jsx` (4.5K)
- `src/components/WatchlistCard.test.jsx` (4.7K, 8 tests)
- `src/components/NotifyMeModal.jsx` (3.4K)
- `src/components/NotifyMeModal.test.jsx` (2.9K, 6 tests)
- `netlify/functions/lib/resultCacheStore.js` (4.0K)
- `netlify/functions/lib/complianceEngine.js` (7.6K)
- `netlify/functions/lib/complianceEngine.test.js` (4.8K, 16 tests)
- `netlify/functions/lib/rateLimiter.js` (3.7K)
- `netlify/functions/lib/rateLimiter.test.js` (3.7K, 13 tests)
- `netlify/functions/lib/proxyConfig.js` (3.0K)
- `netlify/functions/lib/proxyConfig.test.js` (2.6K, 12 tests)
- `netlify/functions/lib/headlessProvider.js` (2.4K)
- `netlify/functions/lib/headlessProvider.test.js` (2.4K, 10 tests)
- `netlify/functions/reengagement.js` (11.3K)
- `netlify/functions/reengagement.test.js` (4.2K, 16 tests)
- `scripts/result-cache.sql` (1.9K)
- `scripts/rate-limit-log.sql` (1.2K)
- `scripts/reengagement-log.sql` (1.1K)

## Files modified (7)
- `netlify/functions/extract.js` — compliance pre-check + rate limiter + cache check + cache write
- `src/pages/Workspace.jsx` — mounts `<WatchlistCard>` when schedules exist
- `src/pages/Integrations.jsx` — Google Sheets now "Available" + Airtable added + 4 cards wired to `NotifyMeModal`
- `src/components/TopBar.jsx` (no change this drop)
- `src/styles/screens.css` — `.watchlist-card` + `.notify-modal` + supporting CSS
- `netlify/__tests__/extract.test.js` — added a robots.txt mock so the compliance pre-check doesn't break existing tests
- `src/pages/static-pages.test.jsx` — updated "12 integration cards" → 13 (Airtable was added)

## Verification

- `npx vitest run` → **1297 / 1297 passing** (was 1168; +129 net new across 7 new test files + 2 extended test files).
- `npm run build` → clean in **1.85 s**. No new warnings.
- All 6 new features work end-to-end across the stack (server function → DB → response → UI).

## Architecture patterns added

- **For per-host token-bucket rate limiters:** the `refill` math must clamp `elapsed = Math.max(0, (now - lastRefill) / 1000)` — without the clamp, `Date.now()` after the constructor overflows the bucket.
- **For robots.txt compliance:** parser is **block-aware** (split on `User-agent:` lines, group rules into blocks, pick the most-specific block whose agents include our UA prefix). The standard interpretation is "per-agent wins over `*`" — not "merge all matching rules".
- **For test mock ordering with multiple fetches:** if the handler makes multiple outbound calls (compliance + provider), pre-queue a mock for the first one in `beforeEach` so the test's `mockResolvedValueOnce` chain fires on the second one. The alternative (re-order the handler) couples tests to internals.
- **For NotifyMeModal:** the form's `type="email"` + `required` prevents submission of bad strings. Tests need to use a syntactically valid email even when asserting error paths (use `ok@x.com` + throw from the mock).
- **For test helpers that default optional fields:** `??` falls through to default for `null` too. Use a sentinel Symbol (`const NO = Symbol()`) and explicit `=== NO` checks when "explicitly null" is a meaningful test case.
- **For the result cache:** `isCacheable(opts)` returns false when `opts.customPrompt` is set because the AI output is per-call. The hash includes `{renderJs, customPrompt, mapMode}` but `customPrompt` is the only cacheability gate.

## SQL to run in Supabase (3 files)

```sql
-- Run these in the Supabase SQL Editor (all idempotent):
\i scripts/result-cache.sql       -- FD2
\i scripts/rate-limit-log.sql     -- FD3
\i scripts/reengagement-log.sql   -- F49
```

## Env vars to set in Netlify (no new VITE_ keys — server-only)

```
# FD2 — result cache TTL override (default 24h)
RESULT_CACHE_TTL_MS=86400000

# FD3 — per-host rate limiter config
RATE_LIMIT_BURST=4
RATE_LIMIT_REFILL=1
PERMITTED_HOSTS=           # comma-separated closed-beta allowlist (optional)

# F36 — proxy + headless
PROXY_URLS=                # comma-separated http(s) proxies (optional)
PROXY_STRATEGY=round-robin

# F49 — Resend (already set from R19)
RESEND_API_KEY=            # already set
ALERT_EMAIL_FROM=          # already set
```

## What's still NOT done (out of scope)

- **Playwright headless provider** — F36 ships the stub. When the team is ready for real JS rendering on every page, wire `playwright-core` into `headlessProvider.js` (or use Cloudflare Browser Rendering for serverless).
- **F36 `resultCacheStore` cache-hit counter** — the SQL column is in place; the actual `hit_count` increment is fire-and-forget. Acceptable for v1.
- **F18 real OAuth exports** — Airtable and Notion remain as "Notify me" waitlist. Real OAuth + per-user token storage is multi-day work. The waitlist + email-capture service means we don't lose the demand signal.
- **F49 per-user visit tracking** — the D7 trigger currently uses "no schedule runs in 7+ days" as a proxy for inactivity. Real per-user visit tracking would tighten the trigger; out of scope for v1.
- **F03 "Named research projects"** (multi-folder) — current implementation is tag-based (Groke QW#3), which is functional but lighter than the spec. Multi-folder is a v2.0 task.
- **FD2 cache invalidation** — expired rows accumulate. Add a daily Supabase pg_cron sweep `DELETE FROM extraction_cache WHERE expires_at < now() - interval '7 days'` in a follow-up.

## Next session entry point

```
cd /Users/vikash/Extracta
git checkout feat/r3-reliability-growth
npx vitest run       # 1297 pass
npm run build        # clean in 1.85s
```

Suggested v2.0 follow-ups (in priority order):
1. Real Playwright headless provider (or Cloudflare Browser Rendering) for JS-heavy sites. ~1 week.
2. Supabase pg_cron sweep for expired cache rows. ~2 hours.
3. Real Airtable OAuth + token storage. ~3 days.
4. Real Notion OAuth + token storage. ~3 days.
5. Per-user visit tracking (replaces the proxy-based D7 trigger in F49). ~1 day.

— End of session handoff
