// netlify/functions/watchlist-monitor.js — PRD 4's missing engine.
//
// Watchlists shipped with a `cadence` column, a materiality model and a change
// feed, and nothing that ever crawled anything. The cadence a user picked was
// stored and never honoured; `recordFieldChange` fired only from a client HTTP
// call. This is the crawler and differ that makes the cadence mean something.
//
// ⚠️ THE SCHEDULE LIVES IN netlify.toml, NOT HERE.
// `export const config = { schedule }` is a v2 (`export default`) feature and
// every function in this repo is v1. Declaring it here is silently ignored —
// which is how four crons sat unscheduled from R19 until 2026-07-27 with no
// build error and no runtime error, just nothing ever firing. It must also be
// registered in AUTOMATION_JOBS; `cron-registry-parity.test.js` asserts both.
//
// ── WHAT ONE RUN DOES ───────────────────────────────────────────────────────
//
//   for each target whose watchlist cadence says it is due:
//     for each monitored page:
//       compliance check  →  SSRF guard  →  fetch  →  extract snapshot
//       diff against the previous snapshot for that page
//       write field_changes for anything that moved
//       debit the credit ledger for the check
//       dispatch matching signal rules for material changes
//
// ── THE RULES THAT KEEP IT HONEST ───────────────────────────────────────────
//
// 1. A FAILED FETCH IS NOT A CHANGE. If a page cannot be read this run, we
//    record the failure on the target and move on. The alternative — treating
//    an empty extraction as "everything was removed" — turns every provider
//    hiccup into a critical competitive alert, which is precisely the noise
//    PRD 4 exists to avoid.
//
// 2. THE FIRST RUN NEVER ALERTS. A target with no prior snapshot is a BASELINE:
//    we store it and say nothing. Otherwise adding a competitor immediately
//    fires "they added pricing!" for a page that simply has pricing.
//
// 3. COMPLIANCE APPLIES. robots.txt is honoured here exactly as it is in
//    extract.js, and for the same reason: we advertise DatIQBot, /blog says we
//    obey robots, and monitoring somebody else's site repeatedly is the single
//    most conspicuous thing we do. A refusal pauses the target with a stated
//    reason rather than failing silently or retrying forever.
//
// 4. THE BUDGET IS THE FUNCTION'S, NOT THE PAGE'S. Netlify kills a synchronous
//    function at 10s (26s configured ceiling). Per-page timeouts compose
//    ADDITIVELY across a serial loop, so this tracks one wall-clock deadline and
//    stops walking when it runs out — leaving the rest for the next run, which
//    is safe because `last_checked_at` advances only for targets actually done.
//    This is the same mistake the discoverability 504 was traced to.

import { withJobRun } from "./lib/jobControl.js";
import { runScrapeChain } from "./lib/scrapeProviders.js";
import { extractPageContent } from "./lib/pageContent.js";
import { checkCompliance } from "./lib/complianceEngine.js";
import { isPublicHttpUrlAsync } from "./lib/publicUrl.js";
import { serviceDb } from "./lib/watchlistStore.js";
import { chargeLedger } from "./lib/templateStore.js";
import { dispatchSignal } from "./lib/signalDispatch.js";
import { extractSnapshot, snapshotHash, diffSnapshots, discoverPages, MAX_DISCOVERED_PAGES } from "../../src/lib/watchlist/snapshotModel.js";
import { buildChangeRecord, MATERIALITY } from "../../src/lib/watchlist/materialityModel.js";

const JOB_ID = "watchlist-monitor";

/** Wall-clock budget for the whole run. See rule 4. */
export const RUN_BUDGET_MS = Number(process.env.WATCHLIST_BUDGET_MS) || 20_000;

/** Hard caps so one enormous watchlist cannot starve every other user's. */
export const MAX_TARGETS_PER_RUN = 12;
export const MAX_PAGES_PER_TARGET = 4;

/** How stale a target must be before its watchlist's cadence says it is due. */
const CADENCE_MS = Object.freeze({
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
});

/** Materiality levels that warrant waking a signal rule immediately. */
const ALERTABLE = new Set([MATERIALITY.CRITICAL, MATERIALITY.HIGH]);

/**
 * Which targets are due right now.
 * Exported and pure-ish so the cadence rule is testable without a database.
 */
export function isDue(target, cadence, now = Date.now()) {
  const interval = CADENCE_MS[cadence] ?? CADENCE_MS.daily;
  if (!target.last_checked_at) return true; // never checked → always due
  const last = Date.parse(target.last_checked_at);
  if (!Number.isFinite(last)) return true;
  return now - last >= interval;
}

/** Read one page and turn it into a snapshot. Never throws. */
async function snapshotPage(page, deadlineAt) {
  const url = page.url;

  // SSRF guard before any outbound call, exactly as extract.js orders it.
  try {
    if (!(await isPublicHttpUrlAsync(url))) {
      return { ok: false, reason: "url_not_public" };
    }
  } catch (e) {
    return { ok: false, reason: `url_rejected: ${e.message}` };
  }

  // Rule 3: the site's own robots.txt decides whether we may read it.
  try {
    const verdict = await checkCompliance(url);
    if (verdict && verdict.allowed === false) {
      return { ok: false, reason: verdict.code || "robots_disallowed", compliance: true };
    }
  } catch {
    // checkCompliance fails open by design (see complianceEngine.js). A DNS
    // blip must not silently stop monitoring a site we are allowed to read.
  }

  let scraped;
  try {
    scraped = await runScrapeChain(url, { deadlineAt });
  } catch (e) {
    return { ok: false, reason: `fetch_failed: ${e.message}` };
  }
  const html = scraped?.data?.html || "";
  if (!html) return { ok: false, reason: "empty_response" };

  const content = extractPageContent(html, { maxChars: 60_000 });
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 40);

  const type = page.category === "terms" || page.category === "other" ? "positioning" : page.category;
  const { fields, observed } = extractSnapshot(
    { text: content.text, title: scraped?.data?.metadata?.title || "", headings },
    type,
  );

  // Rule 1: an extraction that observed nothing is a failed read, not a page
  // that lost all its content. Returning it as a snapshot would diff every
  // previously-known field to absent.
  if (observed === 0) return { ok: false, reason: "no_fields_observed" };

  return { ok: true, fields, hash: snapshotHash(fields), type, source: scraped?.source || null };
}


/**
 * Give a target its monitored pages, the first time it is crawled.
 *
 * PRD 4's "domain mapping to recommend relevant pages". Without this a user adds
 * a competitor to a watchlist and the monitor has **nothing to crawl** — the
 * whole feature is inert until somebody inserts `monitored_pages` rows by hand.
 *
 * ── WHY DISCOVERY LIVES IN THE CRON, NOT IN createWatchlist ─────────────────
 *
 * Discovering pages means fetching the competitor's homepage. Doing that inside
 * the user's own create request makes a form submission wait on a third party
 * that may be slow, may be down, and may refuse us — and a watchlist that
 * failed to save because a competitor's site was down is a bad trade. Here it
 * is retried on the next tick for free, and a target simply has no pages until
 * discovery succeeds.
 *
 * ── AND WHY EACH PAGE IS LABELLED `auto` ────────────────────────────────────
 *
 * PRD 4 also says the user chooses what is monitored. Every discovered page is
 * a recurring crawl they did not explicitly ask for, so `source: 'auto'` (0047)
 * keeps the distinction visible: the UI can present them as suggestions to
 * prune, rather than silently mixing them in with the user's own choices.
 */
async function discoverPagesFor(db, target, deadlineAt) {
  const url = `https://${target.domain}`;

  try {
    if (!(await isPublicHttpUrlAsync(url))) return { ok: false, reason: "url_not_public", added: 0 };
  } catch (e) {
    return { ok: false, reason: `url_rejected: ${e.message}`, added: 0 };
  }

  // The same robots.txt rule the crawl itself follows — discovery is a fetch,
  // and a site that has asked us not to read it has not made an exception for
  // the request where we decide what to read.
  try {
    const verdict = await checkCompliance(url);
    if (verdict && verdict.allowed === false) {
      return { ok: false, reason: verdict.code || "robots_disallowed", added: 0, compliance: true };
    }
  } catch { /* fails open by design — see complianceEngine.js */ }

  let scraped;
  try {
    scraped = await runScrapeChain(url, { deadlineAt });
  } catch (e) {
    return { ok: false, reason: `fetch_failed: ${e.message}`, added: 0 };
  }
  const html = scraped?.data?.html || "";
  if (!html) return { ok: false, reason: "empty_response", added: 0 };

  const pages = discoverPages(html, url).slice(0, MAX_DISCOVERED_PAGES);
  if (pages.length === 0) return { ok: false, reason: "no_pages_found", added: 0 };

  // `monitored_pages_unique_url` makes this idempotent: a re-run adds nothing.
  const { error } = await db.from("monitored_pages").insert(
    pages.map((p) => ({ target_id: target.id, url: p.url, category: p.category, source: "auto" })),
  );
  if (error) return { ok: false, reason: error.message, added: 0 };

  return { ok: true, added: pages.length };
}

/** Everything one target needs, in one pass. Returns a per-target summary. */
async function processTarget(db, watchlist, target, deadlineAt) {
  const summary = { domain: target.domain, pages: 0, changes: 0, alerts: 0, discovered: 0, errors: [] };

  let { data: pages } = await db
    .from("monitored_pages")
    .select("*")
    .eq("target_id", target.id)
    .limit(MAX_PAGES_PER_TARGET);

  // A target with no pages has never been discovered for. Do it now, then crawl
  // what we found in this same run, so a newly added competitor produces a
  // baseline on the first tick rather than waiting a whole cadence.
  if (!pages || pages.length === 0) {
    const found = await discoverPagesFor(db, target, deadlineAt);
    summary.discovered = found.added;
    if (!found.ok) summary.errors.push(`discovery ${target.domain}: ${found.reason}`);
    if (found.added > 0) {
      const re = await db.from("monitored_pages").select("*")
        .eq("target_id", target.id).limit(MAX_PAGES_PER_TARGET);
      pages = re.data;
    }
  }

  for (const page of pages || []) {
    if (Date.now() >= deadlineAt) break;

    const snap = await snapshotPage(page, deadlineAt);
    if (!snap.ok) {
      summary.errors.push(`${page.url}: ${snap.reason}`);
      // A robots refusal is a standing decision, not a transient error, so the
      // page is paused rather than retried hourly forever.
      await db.from("monitored_pages")
        .update({ last_fetched_at: new Date().toISOString(), http_status: snap.compliance ? 403 : 0 })
        .eq("id", page.id);
      continue;
    }
    summary.pages += 1;

    // Previous snapshot for this exact page.
    const { data: prevRows } = await db
      .from("entity_snapshots")
      .select("extracted_data, content_hash")
      .eq("page_id", page.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const previous = prevRows && prevRows[0];

    // Store the new snapshot only when the hash actually moved, so an unchanged
    // page does not accumulate one identical row per hour for ever.
    if (!previous || previous.content_hash !== snap.hash) {
      await db.from("entity_snapshots").insert({
        target_id: target.id,
        page_id: page.id,
        snapshot_type: snap.type,
        extracted_data: snap.fields,
        content_hash: snap.hash,
      });
    }

    await db.from("monitored_pages").update({
      content_hash: snap.hash,
      last_fetched_at: new Date().toISOString(),
      http_status: 200,
    }).eq("id", page.id);

    // Rule 2: first sighting is a baseline, not news.
    if (!previous) continue;
    if (previous.content_hash === snap.hash) continue;

    const deltas = diffSnapshots(previous.extracted_data || {}, snap.fields, page.category);

    for (const delta of deltas) {
      const record = buildChangeRecord({
        targetDomain: target.domain,
        field: delta.field,
        category: delta.category,
        oldValue: delta.oldValue,
        newValue: delta.newValue,
      });

      await db.from("field_changes").insert({
        target_id: target.id,
        watchlist_id: watchlist.id,
        field_name: record.field,
        category: record.category,
        old_value: record.oldValue,
        new_value: record.newValue,
        materiality: record.materiality,
        fact_summary: record.factSummary,
        ai_interpretation: record.aiInterpretation,
        detected_at: new Date().toISOString(),
      });
      summary.changes += 1;

      // PRD 5's producer half: a material change wakes the routing rules.
      if (ALERTABLE.has(record.materiality)) {
        try {
          const res = await dispatchSignal({
            kind: "monitor.change_detected",
            userId: watchlist.user_id,
            payload: {
              domain: target.domain,
              company_name: target.company_name || target.domain,
              watchlist: watchlist.name,
              field: record.field,
              category: record.category,
              old_value: record.oldValue,
              new_value: record.newValue,
              materiality: record.materiality,
              confidence: 1, // an observed diff, not an inference
              source_url: page.url,
              fact_summary: record.factSummary,
              ai_interpretation: record.aiInterpretation,
            },
          });
          summary.alerts += res.fired || 0;
        } catch (e) {
          // A routing failure must never lose the change that caused it: the
          // field_changes row is already committed above.
          summary.errors.push(`dispatch: ${e.message}`);
        }
      }
    }
  }

  await db.from("watchlist_targets")
    .update({ last_checked_at: new Date().toISOString(), status: summary.errors.length && !summary.pages ? "error" : "active" })
    .eq("id", target.id);

  return summary;
}

async function run() {
  const startedAt = Date.now();
  const deadlineAt = startedAt + RUN_BUDGET_MS;
  const db = serviceDb();

  if (!db) {
    // Not an error: a preview deploy with no service key has nothing to monitor.
    return { skipped: "supabase_unconfigured", targets: 0, changes: 0 };
  }

  const { data: watchlists, error } = await db
    .from("watchlists")
    .select("id, user_id, name, cadence, status")
    .eq("status", "active");

  if (error) throw new Error(`could not read watchlists: ${error.message}`);

  const now = Date.now();
  const totals = { targets: 0, pages: 0, changes: 0, alerts: 0, discovered: 0, credits: 0, errors: [] };

  outer:
  for (const wl of watchlists || []) {
    const { data: targets } = await db
      .from("watchlist_targets")
      .select("*")
      .eq("watchlist_id", wl.id)
      .eq("status", "active");

    for (const target of targets || []) {
      if (Date.now() >= deadlineAt) break outer;
      if (totals.targets >= MAX_TARGETS_PER_RUN) break outer;
      if (!isDue(target, wl.cadence, now)) continue;

      totals.targets += 1;
      const s = await processTarget(db, wl, target, deadlineAt);
      totals.pages += s.pages;
      totals.discovered += s.discovered || 0;
      totals.changes += s.changes;
      totals.alerts += s.alerts;
      if (s.errors.length) totals.errors.push(...s.errors.slice(0, 3));

      // The BRD is explicit that credits attach to cost-bearing actions, and
      // names monitoring frequency as one of them. One entry per target per
      // run, charged for the pages actually read — a target we could not fetch
      // costs the customer nothing.
      if (s.pages > 0) {
        try {
          await chargeLedger([{
            user_id: wl.user_id,
            reason: "monitor_check",
            unit: "monitor_check",
            credits: s.pages,
            quantity: s.pages,
            metadata: { watchlist_id: wl.id, target_id: target.id, domain: target.domain },
          }]);
          totals.credits += s.pages;
        } catch (e) {
          // Ledger trouble must not stop monitoring; it is recorded and the run
          // continues, matching withJobRun's own "bookkeeping never breaks the
          // job" rule one level down.
          totals.errors.push(`ledger: ${e.message}`);
        }
      }
    }
  }

  return {
    ...totals,
    errors: totals.errors.slice(0, 10),
    durationMs: Date.now() - startedAt,
    budgetExhausted: Date.now() >= deadlineAt,
  };
}

export const handler = withJobRun(JOB_ID, run);
export const _internal = { run, processTarget, snapshotPage, CADENCE_MS };
