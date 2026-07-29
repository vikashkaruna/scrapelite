// Netlify Scheduled Function — runs recurring extraction schedules.
//
// Fires hourly (see `config.schedule`). For every active schedule whose cron
// matches the current UTC hour, it re-scrapes the target, fingerprints the
// content, compares it to the stored hash, and — when the content changed —
// records the change and fires an alert (webhook). This is the server half of
// the "Track changes" feature; the browser half is schedulerService.js.
//
// Requirements to actually run in production:
//   • SUPABASE_URL + SUPABASE_SERVICE_KEY  (service key bypasses RLS to read/update all users' schedules)
//   • the public.scheduled_tasks table (see schedules.js header / CLAUDE.md)
//   • (optional) SCHEDULE_ALERT_WEBHOOK or VITE_WEBHOOK_URL for change alerts
//
// Netlify auto-registers any function that exports `config.schedule`.

import { runScrapeChain } from "./lib/scrapeProviders.js";
import { computeLifecycle } from "../../src/lib/entitlementModel.js";
import { PLAN_BY_ID } from "../../src/lib/pricingConfig.js";
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

// Compose the change-alert email body.
function changeEmailHtml(schedule, detectedAt) {
  const isBatch = schedule.type === "batch";
  const target = isBatch
    ? `${schedule.target.length} URL${schedule.target.length !== 1 ? "s" : ""}`
    : escapeHtml(schedule.target);
  const row = (k, v) =>
    `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">${k}</td>` +
    `<td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600">${v}</td></tr>`;
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto">` +
    `<div style="background:#4f46e5;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0">` +
    `<div style="font-size:13px;letter-spacing:.04em;opacity:.85;text-transform:uppercase">DatIQ · Monitoring</div>` +
    `<div style="font-size:20px;font-weight:800;margin-top:4px">Content changed</div></div>` +
    `<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px 22px;background:#fff">` +
    `<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.55">` +
    `Your schedule <strong>${escapeHtml(schedule.label)}</strong> detected a change since the last check.</p>` +
    `<table style="border-collapse:collapse;margin-bottom:18px">` +
    row("What", isBatch ? "Batch monitor" : "Tracked page") +
    row("Target", target) +
    row("Extracting", escapeHtml(schedule.intent || "summary")) +
    row("Detected", new Date(detectedAt).toUTCString()) +
    `</table>` +
    `<a href="${SITE_URL}/schedules" style="display:inline-block;background:#4f46e5;color:#fff;` +
    `text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:9px">View in DatIQ →</a>` +
    `<p style="margin:18px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">` +
    `You're receiving this because you set up a DatIQ monitoring schedule with this email. ` +
    `Pause or remove it anytime on the Schedules page.</p>` +
    `</div></div>`
  );
}

// Direct email via Resend (https://resend.com) — REST, no SDK. Returns true on send.
async function sendAlertEmail(schedule, detectedAt) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !schedule.alertEmail) return false;
  const from = process.env.ALERT_EMAIL_FROM || "DatIQ Alerts <alerts@datiq.app>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [schedule.alertEmail],
        subject: `DatIQ — content changed: ${schedule.label}`,
        html: changeEmailHtml(schedule, detectedAt),
      }),
    });
    if (!res.ok) {
      console.warn(`[DatIQ] Resend alert failed (${res.status})`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[DatIQ] Resend alert error:", err.message);
    return false;
  }
}

// Post a change event to the automation webhook (n8n / Zapier / Make), if set.
//
// TODO(SCHEDULE_ALERT_WEBHOOK): wire up a real automation endpoint and add
// it to Netlify per context before the production cutover:
//   • production context  → real n8n/Zapier URL that posts to Slack / email / etc.
//   • staging context     → staging n8n URL (or empty for now)
//   • deploy-preview      → empty (skip alerts for PR previews)
// Until this is set, change alerts are silently dropped (this function returns
// early on the empty `hook` check below). See NETLIFY-ENVIRONMENTS.md §5.2
// for the full per-context env var list, and the VITE_WEBHOOK_URL row in
// §6 for the build-time fallback that's currently the only value wired.
async function postAlertWebhook(schedule, changedSummary, detectedAt, emailed) {
  const hook = process.env.SCHEDULE_ALERT_WEBHOOK || process.env.VITE_WEBHOOK_URL || "";
  if (!hook) return;
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "schedule.changed",
        scheduleId: schedule.id,
        label: schedule.label,
        type: schedule.type,
        intent: schedule.intent,
        alertEmail: schedule.alertEmail || null,
        emailSent: emailed,            // true if Resend already delivered the email
        target: schedule.target,
        ...changedSummary,
        at: detectedAt,
      }),
    });
  } catch (err) {
    console.warn("[DatIQ] alert webhook failed:", err.message);
  }
}

// Notify on a detected change: send a real email (Resend) AND post the webhook
// event (for automations). Either path is optional; both degrade gracefully.
async function fireAlert(schedule, changedSummary) {
  const detectedAt = new Date().toISOString();
  const emailed = await sendAlertEmail(schedule, detectedAt);
  await postAlertWebhook(schedule, changedSummary, detectedAt, emailed);
  // F17: also post a Slack Block Kit message when SLACK_WEBHOOK_URL is set.
  if (process.env.SLACK_WEBHOOK_URL) {
    const payload = buildSlackChangeAlert(schedule, changedSummary, detectedAt);
    const r = await postToSlack(payload);
    if (!r.ok) {
      console.warn(`[DatIQ] Slack alert failed (${r.status || r.error})`);
    }
  }
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
    await fireAlert(schedule, { newHash, previousHash: schedule.lastHash });
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
      const schedule = { ...(row.data || {}), id: row.id };
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
