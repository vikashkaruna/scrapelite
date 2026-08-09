// billing-lifecycle.js — the daily subscription lifecycle sweep.
//
// Advances active → suspended → deactivated, sends the dunning series, applies
// scheduled downgrades, and pauses/resumes the automation of lapsed accounts.
//
// DELIBERATELY DOES NOT DELETE ANYTHING. Purging is a separate function
// (billing-purge.js) with its own kill switch, so a bug in dunning logic can
// never destroy customer data. See the interlock note there.
//
// BATCH-FIRST. reengagement.js loops per user and issues several REST calls
// each, which will not survive a few thousand accounts inside a function's time
// budget. This reads all candidates in one query, groups the writes, and only
// falls back to per-user calls for the things that genuinely need them (email).
//
// Netlify may double-fire a scheduled function. Every side effect here is
// therefore idempotent: status writes are convergent (computed from dates, not
// incremented), and notices are claimed by a unique constraint before sending.
import {
  STATUS,
  computeLifecycle,
  isLifecycleManaged,
} from "../../src/lib/entitlementModel.js";
import { pickDueNotice, noticeCopy } from "../../src/lib/billingNotices.js";
import { PLAN_BY_ID } from "../../src/lib/pricingConfig.js";
import { withJobRun } from "./lib/jobControl.js";

// NOTE: this `config` export does NOT register the cron — it is only honoured
// for v2 functions (`export default`), and this is a v1 handler. The real
// schedule lives in netlify.toml under [functions."billing-lifecycle"]. Keep both in sync;
// netlify.toml is authoritative.
export const config = { schedule: "@daily" };

const LOOKAHEAD_DAYS = 8; // enough to catch renewal_t7 plus a day of slack
const DAY = 24 * 60 * 60 * 1000;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const PAGE = 500;

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

    /** Everyone whose cycle is near or past its end, in one query. */
    async candidates() {
      const cutoff = new Date(Date.now() + LOOKAHEAD_DAYS * DAY).toISOString();
      const url =
        `${base}/entitlements` +
        `?source=eq.payment` +
        `&period_end=not.is.null` +
        `&period_end=lt.${encodeURIComponent(cutoff)}` +
        `&status=neq.purged` +
        `&select=*&limit=${PAGE}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`entitlements read → HTTP ${res.status}`);
      return (await res.json()) || [];
    },

    async patchEntitlement(userId, patch) {
      return fetch(`${base}/entitlements?user_id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
    },

    /**
     * Claim the right to send a notice BEFORE sending it.
     *
     * Returns true only if this call inserted the row. `resolution=ignore-
     * duplicates` + `return=representation` means a duplicate comes back as an
     * empty array rather than an error, so two concurrent containers cannot
     * both decide they own the send. reengagement.js does read-then-write here,
     * which has a real window between the check and the insert.
     */
    async claimNotice(userId, kind, windowKey) {
      const res = await fetch(`${base}/billing_notice_log`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({ user_id: userId, kind, window_key: windowKey }),
      });
      if (!res.ok) return false;
      const rows = await res.json().catch(() => []);
      return Array.isArray(rows) && rows.length > 0;
    },

    /** Pause every schedule owned by a lapsed account. */
    async systemPauseSchedules(userId, reason = "subscription_suspended") {
      return fetch(
        `${base}/scheduled_tasks?user_id=eq.${encodeURIComponent(userId)}&system_paused=is.false`,
        {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({ system_paused: true, system_pause_reason: reason }),
        },
      );
    },

    /**
     * Resume only what WE paused, and only for the matching reason.
     *
     * A schedule the user paused themselves has status='paused' and is not
     * touched here, so their own intent survives a lapse-and-reactivate cycle.
     */
    async systemResumeSchedules(userId, reason = "subscription_suspended") {
      return fetch(
        `${base}/scheduled_tasks?user_id=eq.${encodeURIComponent(userId)}` +
          `&system_pause_reason=eq.${encodeURIComponent(reason)}`,
        {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({ system_paused: false, system_pause_reason: null }),
        },
      );
    },

    async recordRun(job, detail) {
      return fetch(`${base}/billing_cron_runs`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ job, last_success: new Date().toISOString(), last_detail: detail }),
      });
    },

    /** Resolve emails in one admin call rather than one per user. */
    async emailsFor(userIds) {
      const out = {};
      if (!userIds.length) return out;
      try {
        const res = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers });
        if (!res.ok) return out;
        const data = await res.json();
        for (const u of data?.users || []) {
          if (userIds.includes(u.id)) out[u.id] = u.email;
        }
      } catch {
        /* best effort */
      }
      return out;
    },
  };
}

function fmtDate(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function noticeHtml({ heading, body, cta }, ctaUrl, urgent) {
  return `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:${urgent ? "#b91c1c" : "#4f46e5"};border-radius:12px 12px 0 0;padding:20px 24px">
      <div style="color:#fff;font-size:18px;font-weight:700">DatIQ</div>
      <div style="color:#e0e7ff;font-size:12px">Intelligence from every URL</div>
    </div>
    <div style="background:#fff;border:1px solid #e1e3e9;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <h1 style="margin:0 0 10px;font-size:17px;color:#20222c">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 20px;font-size:14px;color:#4b5162;line-height:1.6">${escapeHtml(body)}</p>
      <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">${escapeHtml(cta)}</a>
    </div>
    <p style="text-align:center;color:#9aa0af;font-size:11px;margin-top:16px">Questions? Just reply to this email.</p>
  </div></body></html>`;
}

async function sendNotice({ to, kind, copy, siteUrl, urgent }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  const from = process.env.BILLING_EMAIL_FROM || "DatIQ Billing <billing@datiq.app>";
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: "hello@datiq.app",
        subject: copy.subject,
        html: noticeHtml(copy, `${siteUrl}/account`, urgent),
        text: `${copy.heading}\n\n${copy.body}\n\n${siteUrl}/account`,
        tags: [
          { name: "stream", value: "billing" },
          { name: "kind", value: kind },
        ],
      }),
    });
    // Never echo the response body — it can contain the key.
    if (!res.ok) console.error(`[billing-lifecycle] Resend HTTP ${res.status} for ${kind}`);
    return res.ok;
  } catch (err) {
    console.error("[billing-lifecycle] send threw:", err?.message);
    return false;
  }
}

/**
 * Decide what should change for one account. Pure — exported for tests.
 *
 * @returns {{patch: object|null, notice: object|null, pauseSchedules: boolean}}
 */
export function planTransition(ent, now = new Date()) {
  if (!isLifecycleManaged(ent)) return { patch: null, notice: null, pauseSchedules: false };

  const life = computeLifecycle(ent, now);
  const nowIso = new Date(now).toISOString();
  const patch = {};

  // Status only ever advances here; computeLifecycle already takes the stricter
  // of stored and computed, so this write is convergent and safe to repeat.
  if (life.status !== ent.status) {
    patch.status = life.status;
    if (life.status === STATUS.SUSPENDED && !ent.suspended_at) patch.suspended_at = nowIso;
    if (life.status === STATUS.DEACTIVATED && !ent.deactivated_at) patch.deactivated_at = nowIso;
    if (life.purgeAt) patch.purge_after = new Date(life.purgeAt).toISOString();
  }

  // A scheduled downgrade lands at the end of the period the customer paid for.
  //
  // NOTE ON v1.0 SEMANTICS: with one-time Razorpay Orders there is no
  // auto-charge, so this does not silently start billing the cheaper plan. It
  // records the user's intent for their NEXT purchase and, because the period
  // has ended, the account also lapses to suspended in the same sweep. The UI
  // copy says exactly this.
  const schedAt = ent.scheduled_at ? Date.parse(ent.scheduled_at) : null;
  if (ent.scheduled_plan_id && Number.isFinite(schedAt) && now.getTime() >= schedAt) {
    patch.plan_id = ent.scheduled_plan_id;
    patch.scheduled_plan_id = null;
    patch.scheduled_at = null;
  }

  const notice = pickDueNotice(ent, now);

  return {
    patch: Object.keys(patch).length ? patch : null,
    notice,
    // Automation stops the moment the account is no longer active (requirement 9).
    pauseSchedules: life.status !== STATUS.ACTIVE,
  };
}

const run = async () => {
  const db = sb();
  if (!db) return { statusCode: 200, body: "skipped (no supabase)" };

  const now = new Date();
  const siteUrl = process.env.URL || process.env.SITE_URL || "https://datiq.app";

  let rows;
  try {
    rows = await db.candidates();
  } catch (err) {
    console.error("[billing-lifecycle]", err.message);
    return { statusCode: 500, body: `failed: ${err.message}` };
  }

  const stats = { scanned: rows.length, transitioned: 0, notices: 0, paused: 0, resumed: 0, downgrades: 0 };

  // One admin call for every address we might need.
  const noticeCandidates = rows
    .map((r) => ({ r, t: planTransition(r, now) }))
    .filter(({ t }) => t.notice);
  const emails = await db.emailsFor(noticeCandidates.map(({ r }) => r.user_id));

  for (const row of rows) {
    const { patch, notice, pauseSchedules } = planTransition(row, now);

    try {
      if (patch) {
        if (patch.plan_id) stats.downgrades += 1;
        patch.version = (row.version ?? 0) + 1;
        patch.updated_at = now.toISOString();
        await db.patchEntitlement(row.user_id, patch);
        stats.transitioned += 1;
      }

      // Requirement 9: automated modules stay suspended until payment.
      // Idempotent on both sides — the filters make a repeat a no-op.
      if (pauseSchedules) {
        await db.systemPauseSchedules(row.user_id);
        stats.paused += 1;
      } else {
        // SAFETY NET, not the primary path. Reactivation on payment resumes
        // schedules immediately in invoiceService.activateFromInvoice, because
        // requirement 10 says a paying customer's automation comes back without
        // them having to do anything — waiting up to 24h for this cron is not
        // "without interruption".
        //
        // This runs unconditionally for an active account because it is
        // idempotent: the PATCH is scoped by system_pause_reason, so it matches
        // nothing when there is nothing to resume, and can never disturb a
        // schedule the USER paused (that one carries status='paused' instead).
        await db.systemResumeSchedules(row.user_id);
        stats.resumed += 1;
      }

      if (notice) {
        // Claim first: if another container already owns this send, skip.
        const owned = await db.claimNotice(row.user_id, notice.kind, notice.windowKey);
        if (owned) {
          const planName = PLAN_BY_ID[row.plan_id]?.name || row.plan_id || "your plan";
          const copy = noticeCopy(notice.kind, {
            planName,
            endsOn: fmtDate(row.period_end),
            purgeOn: fmtDate(row.purge_after || (row.period_end ? Date.parse(row.period_end) + 90 * DAY : null)),
          });
          await sendNotice({
            to: emails[row.user_id],
            kind: notice.kind,
            copy,
            siteUrl,
            urgent: notice.kind.startsWith("delete_"),
          });
          // last_notice_kind is the purge interlock: billing-purge refuses to
          // delete anyone who has not reached delete_d90.
          await db.patchEntitlement(row.user_id, { last_notice_kind: notice.kind });
          stats.notices += 1;
        }
      }
    } catch (err) {
      // One bad row must not abort the sweep.
      console.error(`[billing-lifecycle] user ${row.user_id}:`, err?.message);
    }
  }

  await db.recordRun("billing-lifecycle", stats);

  const summary =
    `scanned ${stats.scanned}, transitioned ${stats.transitioned}, ` +
    `notices ${stats.notices}, paused ${stats.paused}, resumed ${stats.resumed}, ` +
    `downgrades ${stats.downgrades}`;
  console.log(`[billing-lifecycle] ${summary}`);
  return { statusCode: 200, body: summary };
};

// Wrapped for /admin/monitoring — see jobControl.js.
//
// This is ALSO why stopping this job is dangerous enough to need a written
// reason: billing-purge refuses to delete anything unless this job has
// succeeded within STALE_HOURS, so stopping it silently disarms the purge. That
// is the safe direction to fail, but it is not obvious from this file alone.
// The `recordRun` call above still writes billing_cron_runs, which is the
// interlock the purge reads; job_runs is the monitoring view and does not
// replace it.
export const handler = withJobRun("billing-lifecycle", run);

export const _internal = { sb, planTransition, sendNotice, fmtDate };
