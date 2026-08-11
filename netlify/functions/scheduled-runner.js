// Netlify Scheduled Function — runs recurring extraction schedules.
//
// Fires hourly (see `config.schedule`). For every active schedule whose cron
// matches the current UTC hour, it re-scrapes the target, fingerprints the
// content, compares it to the stored hash, and — when the content changed —
// records the change and enqueues a `schedule.changed` event into the
// workflow pipeline. The orchestrator (netlify/functions/workflow-orchestrator.js)
// then dispatches the event to self-hosted n8n, which fans out to email/Slack/etc.
//
// v2 plan: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §8
// Replaces the previous direct Resend/Slack/webhook delivery with the
// `enqueueEvent()` queue so we get retries, observability, and an MCP surface.
//
// Requirements to actually run in production:
//   • SUPABASE_URL + SUPABASE_SERVICE_KEY  (service key bypasses RLS to read/update all users' schedules)
//   • the public.scheduled_tasks table (see schedules.js header / CLAUDE.md)
//   • the public.workflow_events table (supabase/migrations/0018_workflow_events.sql)
//
// Netlify auto-registers any function that exports `config.schedule`.

import { runScrapeChain } from "./lib/scrapeProviders.js";
import { computeLifecycle } from "../../src/lib/entitlementModel.js";
import { PLAN_BY_ID } from "../../src/lib/pricingConfig.js";
import { enqueue, buildCtx } from "./lib/workflowEnqueue.js";
import { buildSlackChangeAlert, postToSlack } from "./lib/slackFormatter.js";
import { cronMatchesHour } from "../../src/lib/monitoringModel.js";
import { withJobRun } from "./lib/jobControl.js";

// NOTE: this `config` export does NOT register the cron — it is only honoured
// for v2 functions (`export default`), and this is a v1 handler. The real
// schedule lives in netlify.toml under [functions."scheduled-runner"]. Keep both in sync;
// netlify.toml is authoritative.
export const config = { schedule: "@hourly" };

// Cap batch schedules so one run can't fan out unbounded.
const BATCH_SCRAPE_CAP = 25;

// ── FNV-1a content fingerprint (matches utils.hashContent) ───────────────────
function hashContent(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Strip tags + collapse whitespace → a stable visible-text fingerprint source.
function visibleText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}

// ── Cron matching ────────────────────────────────────────────────────────────
// Deliberately NOT a local copy. `cronMatchesHour` used to be duplicated here,
// and /admin/monitoring shows a "next run" for every schedule — two independent
// implementations of the same cron grammar would eventually disagree, and the
// dashboard would confidently predict a run that never came. One implementation,
// in src/lib/monitoringModel.js, imported by both. The minute field is ignored
// there for the same reason it was ignored here: this function fires hourly.

// ── Supabase REST helpers (service key; no SDK to keep the bundle small) ──────
function sb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  const base = `${url}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  return {
    base,
    headers,
    async listActive() {
      // Two additions to the original `status=eq.active&select=id,data`:
      //
      //  • system_paused=is.false — the billing lifecycle pauses a lapsed
      //    subscriber's automation through a column the client cannot write
      //    (column REVOKE in 0015). `status` remains the USER's own intent, so
      //    a schedule they paused themselves stays paused independently.
      //
      //  • user_id in the projection — the runner previously had no idea who
      //    owned a schedule, so it could not tell whether that owner was still
      //    entitled to run one. It executed everything, forever, for free.
      const res = await fetch(
        `${base}/scheduled_tasks?status=eq.active&system_paused=is.false&select=id,user_id,data`,
        { headers },
      );
      if (!res.ok) throw new Error(`list ${res.status}`);
      return res.json();
    },

    /**
     * Entitlements for a set of owners, in ONE request.
     *
     * Per-schedule lookups would put an unbounded number of round-trips inside
     * the hourly budget; this is a single `in.(...)` filter, read once per run.
     */
    async entitlementsFor(userIds) {
      const ids = [...new Set(userIds.filter(Boolean))];
      if (!ids.length) return {};
      const list = ids.map((i) => `"${i}"`).join(",");
      const res = await fetch(
        `${base}/entitlements?user_id=in.(${encodeURIComponent(list)})` +
          `&select=user_id,plan_id,status,source,period_end,comp_until`,
        { headers },
      );
      if (!res.ok) return {};
      const rows = (await res.json()) || [];
      return Object.fromEntries(rows.map((r) => [r.user_id, r]));
    },
    async patch(id, fields) {
      const res = await fetch(`${base}/scheduled_tasks?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`patch ${res.status}`);
    },
  };
}

const SITE_URL = process.env.URL || process.env.SITE_URL || "https://datiq.app";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Enqueue a `schedule.changed` event for the workflow pipeline. The orchestrator
// (netlify/functions/workflow-orchestrator.js) polls every 5 min and dispatches
// the event to self-hosted n8n, which fans out to email/Slack/etc.
//
// v2 plan: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §8. Replaces the previous
// direct Resend/Slack/webhook delivery with the queue so we get retries,
// observability, and an MCP surface.
//
// `client` is the supabase client built in `sb()` above. `schedule` is the
// merged schedule object (id + data). `changedSummary` is {newHash, previousHash}.
async function enqueueChange(client, schedule, changedSummary) {
  if (!client) {
    console.warn("[DatIQ] scheduled-runner: no supabase client — change alert dropped");
    return { ok: false, error: "no_client" };
  }
  const detectedAt = new Date().toISOString();
  const result = await enqueue(client, {
    kind: "schedule.changed",
    refId: schedule.id,
    // The runner builds the schedule object with `user_id` (snake_case,
    // matching the supabase row projection in listActive()). The enqueue
    // helper accepts `userId` (camelCase) and maps it to `user_id` in
    // the workflow_events row. Reading the wrong key here would silently
    // drop per-user fan-out (the orchestrator would resolve the OWNER's
    // Slack + Zapier subscriptions to nothing).
    userId: schedule.user_id || null,
    payload: {
      scheduleId: schedule.id,
      label: schedule.label,
      type: schedule.type,
      intent: schedule.intent,
      target: schedule.target,
      alertEmail: schedule.alertEmail || null,
      renderJs: schedule.renderJs || false,
      customPrompt: schedule.customPrompt || null,
      newHash: changedSummary.newHash,
      previousHash: changedSummary.previousHash || null,
      detectedAt,
      siteUrl: SITE_URL,
    },
    // _ctx flows with the event so n8n knows which DatIQ environment
    // produced it (used for the Supabase URL, site URL, branch name).
    // See netlify/functions/lib/workflowEnqueue.js buildCtx().
    _ctx: buildCtx(),
    channels: [
      // Default delivery channels for this event kind. The n8n workflow
      // also reads `workflow_subscriptions` for per-user preferences and
      // can add/remove channels at dispatch time.
      { type: "email", to: schedule.alertEmail || null, template: "schedule.changed" },
      { type: "slack", channel: "#monitoring", template: "schedule.changed" },
    ],
  });
  if (!result.ok) {
    console.warn(`[DatIQ] scheduled-runner: enqueue failed for ${schedule.id}: ${result.error}`);
  }
  return result;
}

// Scrape one target and return a content fingerprint string.
async function fingerprintTarget(target, opts) {
  const r = await runScrapeChain(target, opts);
  if (!r.ok) throw new Error(r.error || "scrape failed");
  return `${r.title || ""}\n${visibleText(r.html)}`;
}

async function runSchedule(db, schedule) {
  const opts = {};
  if (schedule.renderJs) opts.renderJs = true;
  if (schedule.customPrompt) opts.customPrompt = schedule.customPrompt;

  let content;
  if (schedule.type === "batch" && Array.isArray(schedule.target)) {
    const targets = schedule.target.slice(0, BATCH_SCRAPE_CAP);
    const parts = [];
    for (const t of targets) {
      try { parts.push(await fingerprintTarget(t, opts)); }
      catch { parts.push(`__error__:${t}`); }
    }
    content = parts.join("\n----\n");
  } else {
    content = await fingerprintTarget(schedule.target, opts);
  }

  const now = new Date().toISOString();
  const newHash = hashContent(content);
  const changed = schedule.lastHash && schedule.lastHash !== newHash;

  const next = {
    ...schedule,
    lastRunAt: now,
    lastHash: newHash,
    lastStatus: changed ? "changed" : "unchanged",
    lastChangeAt: changed ? now : (schedule.lastChangeAt || null),
    runCount: (schedule.runCount || 0) + 1,
  };

  await db.patch(schedule.id, { data: next, next_run_at: null });

  if (changed) {
    await enqueueChange(db, schedule, { newHash, previousHash: schedule.lastHash });
  }
  return next.lastStatus;
}

const run = async () => {
  const db = sb();
  if (!db) {
    console.log("[DatIQ] scheduled-runner: Supabase service key not configured — skipping.");
    return { statusCode: 200, body: "skipped (no supabase)" };
  }

  const now = new Date();
  let scanned = 0, ran = 0, changed = 0, failed = 0;
  let skippedLapsed = 0, skippedPlan = 0, skippedOrphan = 0;

  try {
    const rows = await db.listActive();

    // Resolve every owner's entitlement up front (one query for the whole run).
    const entMap = await db.entitlementsFor(rows.map((r) => r.user_id));

    for (const row of rows) {
      // user_id is projected at the top level (see listActive() — the join
      // is a Supabase column on scheduled_tasks), so it needs to be
      // re-attached to the schedule object before runSchedule/fireAlert
      // can use it. The change-alert fan-out (notifyMonitoringChange)
      // resolves the OWNER's per-user Slack webhook from this id.
      const schedule = { ...(row.data || {}), id: row.id, user_id: row.user_id || null };
      if (!schedule.cron || !schedule.target) continue;
      scanned++;

      // ── Entitlement gate (requirement 9) ────────────────────────────────
      // A lapsed subscriber's automation must not keep running. The same pure
      // computeLifecycle the UI and the API use decides this, so a stalled
      // billing cron cannot leave automation running indefinitely — the runner
      // re-derives the status from the dates itself.
      //
      // FAIL OPEN ON UNKNOWN, CLOSED ONLY ON A KNOWN NON-ACTIVE STATUS — the
      // same asymmetry as lib/requireEntitlement.js. A missing entitlement row,
      // or a row with no owner at all, means we could not DETERMINE the
      // entitlement; that is not evidence of a lapse, and silently stopping
      // someone's monitoring on a maybe is far worse than running it. Only an
      // explicit lapsed/deactivated status, or a plan that genuinely has no
      // scheduled monitoring, stops a run.
      const ent = row.user_id ? entMap[row.user_id] : null;
      if (ent) {
        if (computeLifecycle(ent, now).status !== "active") {
          skippedLapsed++;
          continue;
        }
        if ((PLAN_BY_ID[ent.plan_id]?.limits?.scheduled_monitoring ?? 0) === 0) {
          skippedPlan++;
          continue;
        }
      } else if (!row.user_id) {
        // Counted, not skipped: these should not exist (schedules.js always
        // stamps the JWT subject) so a non-zero figure here is worth noticing.
        skippedOrphan++;
      }
      // Skip schedules past their end date ("run until").
      if (schedule.expiresAt && new Date(schedule.expiresAt) < now) continue;
      if (!cronMatchesHour(schedule.cron, now)) continue;

      // De-dupe: skip if it already ran within this hour.
      if (schedule.lastRunAt) {
        const last = new Date(schedule.lastRunAt);
        if (now - last < 50 * 60 * 1000) continue;
      }

      try {
        const status = await runSchedule(db, schedule);
        ran++;
        if (status === "changed") changed++;
      } catch (err) {
        failed++;
        console.warn(`[DatIQ] schedule ${schedule.id} failed:`, err.message);
        const errNext = { ...schedule, lastRunAt: new Date().toISOString(), lastStatus: "error" };
        try { await db.patch(schedule.id, { data: errNext }); } catch { /* ignore */ }
      }
    }
  } catch (err) {
    console.error("[DatIQ] scheduled-runner error:", err.message);
    return { statusCode: 500, body: err.message };
  }

  // Skips are reported explicitly rather than silently: "ran 0" with no
  // explanation is indistinguishable from a broken runner.
  const summary =
    `scanned ${scanned}, ran ${ran}, changed ${changed}, failed ${failed}, ` +
    `skipped ${skippedLapsed} lapsed / ${skippedPlan} plan; ${skippedOrphan} unowned`;
  console.log("[DatIQ] scheduled-runner:", summary);
  return { statusCode: 200, body: summary };
};

// Wrapped so /admin/monitoring can see and stop this job. withJobRun opens a
// job_runs row, closes it with the outcome, and returns early without running
// `run` when an operator has stopped the job. It fails OPEN — see jobControl.js.
export const handler = withJobRun("scheduled-runner", run);
