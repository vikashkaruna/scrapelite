// netlify/functions/discoverability-monitor.js
//
// Scheduled monitoring: re-audits every page a user is watching, compares the
// result against the previous run, and alerts when the score moves materially.
//
// ⚠️ THE SCHEDULE LIVES IN netlify.toml, NOT HERE.
// `export const config = { schedule }` is a v2 (`export default`) feature and
// every function in this repo is v1 (`export const handler`). Declaring it here
// would be silently ignored — which is exactly how all four crons sat
// unscheduled from R19 until 2026-07-27, with no build error and no runtime
// error, just nothing ever firing.
//
// ── WHY THIS DOES NOT REUSE scheduled-runner.js ────────────────────────────
// That cron re-EXTRACTS a page and fingerprints its content for change. This
// re-AUDITS and compares scores. They share a cadence and nothing else: the
// row shape, the alert condition and the failure mode are all different, and
// folding them together would put two unrelated job kinds behind one cron's
// assumptions.
//
// ── ALERTS FIRE ON MOVEMENT, NOT ON EXISTENCE ──────────────────────────────
// A weekly monitor that emails every week regardless is a weekly monitor
// nobody reads by week four. Mail goes out only when the overall score moves
// past the schedule's own threshold, or a new critical issue appears — and
// only when the two audits are actually COMPARABLE, because a move caused by
// PageSpeed being unavailable last week is not news about the page.

import { withJobRun } from "./lib/jobControl.js";
import { runAudit } from "./lib/audit/auditPipeline.js";
import * as store from "./lib/audit/auditStore.js";
import { diffAudits } from "../../src/lib/discoverability/auditDiff.js";
import { dispatchAuditEvent } from "./lib/audit/webhookDispatch.js";
import { checkCompliance } from "./lib/complianceEngine.js";
import { hasScrapeConsent } from "./lib/scrapeConsent.js";
import { isPublicHttpUrlAsync } from "./lib/publicUrl.js";

const JOB_ID = "discoverability-monitor";

/** Cap per run. Each schedule is a full audit; the function has a time budget. */
export const MAX_SCHEDULES_PER_RUN = 15;

/**
 * Should this movement produce mail?
 *
 * Two independent triggers, both requiring the comparison to be meaningful:
 *   • the overall score moved by at least the schedule's threshold
 *   • a new CRITICAL issue appeared
 *
 * A new critical issue alerts regardless of score movement, because a page that
 * silently became unindexable is the whole reason to watch it, and a penalty
 * can land without moving the headline much on an already-low page.
 */
export function shouldAlert(diff, threshold = 3) {
  if (!diff) return { alert: false, reason: null };

  const introducedCritical = (diff.issues?.introduced || []).filter((i) => i.severity === "critical");
  if (introducedCritical.length > 0) {
    return {
      alert: true,
      reason: `New critical issue: ${introducedCritical.map((i) => i.code).join(", ")}`,
      kind: "regression",
    };
  }

  const overall = diff.frameworks?.overall;
  // Not comparable means we cannot say the page changed. Alerting on it would
  // report our own measurement gap as the user's regression.
  if (!overall?.comparable) return { alert: false, reason: "scores are not comparable" };

  if (Math.abs(overall.change) >= threshold) {
    return {
      alert: true,
      reason: `Overall score ${overall.change > 0 ? "rose" : "fell"} ${Math.abs(overall.change)} points`,
      kind: overall.change > 0 ? "improvement" : "regression",
    };
  }
  return { alert: false, reason: "below the alert threshold" };
}

/** Alert mail. Never throws — a mail failure must not fail the monitored run. */
async function sendAlert({ schedule, diff, result, verdict }) {
  const to = schedule.alert_email;
  const key = process.env.RESEND_API_KEY;
  if (!to || !key) return { sent: false, reason: !to ? "no recipient" : "no mail key" };

  const from = process.env.ALERT_EMAIL_FROM || "DatIQ Alerts <alerts@datiq.app>";
  const site = process.env.URL || process.env.SITE_URL || "https://datiq.app";
  const url = schedule.audit_targets?.canonical_url || result?.target?.url || "your page";
  const improved = verdict.kind === "improvement";

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px">Discoverability ${improved ? "improved" : "changed"}</h2>
      <p style="color:#555;margin:0 0 16px">${escapeHtml(url)}</p>
      <p style="font-size:15px"><strong>${escapeHtml(diff.headline)}</strong></p>
      <table style="border-collapse:collapse;font-size:14px;margin:14px 0">
        ${["overall", "seo", "aeo", "geo"].map((f) => {
          const d = diff.frameworks?.[f];
          if (!d) return "";
          return `<tr>
            <td style="padding:3px 12px 3px 0;color:#666">${f.toUpperCase()}</td>
            <td style="padding:3px 12px 3px 0"><strong>${d.after ?? "—"}</strong></td>
            <td style="padding:3px 0;color:${d.comparable && d.change < 0 ? "#b91c1c" : "#15803d"}">
              ${d.comparable ? `${d.change > 0 ? "+" : ""}${d.change}` : "not comparable"}
            </td></tr>`;
        }).join("")}
      </table>
      ${(diff.issues?.introduced || []).length ? `<p style="color:#b91c1c"><strong>New issues:</strong> ${
        diff.issues.introduced.map((i) => escapeHtml(`${i.code} — ${i.title}`)).join("<br>")}</p>` : ""}
      ${(diff.caveats || []).map((c) => `<p style="color:#777;font-size:12px">${escapeHtml(c)}</p>`).join("")}
      <p><a href="${site}/discoverability?audit=${result?.auditId || ""}"
            style="display:inline-block;padding:9px 16px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">
        View the full audit</a></p>
      <p style="color:#999;font-size:11px;margin-top:20px">
        Scores describe how discoverable this page is today. They are not a prediction of rankings, citations or traffic.
      </p>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to],
        subject: `${improved ? "↑" : "↓"} Discoverability ${verdict.kind} — ${hostOf(url)}`,
        html,
      }),
    });
    return { sent: res.ok, status: res.status };
  } catch (err) {
    return { sent: false, reason: err?.message || "mail failed" };
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return String(url || "").slice(0, 40); }
}

/** Run one schedule end to end. Returns a summary; never throws. */
export async function runSchedule(schedule, opts = {}) {
  const url = schedule.audit_targets?.canonical_url;
  const summary = { scheduleId: schedule.id, url, ran: false, alerted: false, error: null };
  if (!url) { summary.error = "schedule has no target URL"; return summary; }

  try {
    // The same gates the interactive path applies. A monitored page whose
    // robots.txt changed to disallow us must stop being fetched — a schedule
    // is not a standing exemption from the site's own policy, and a cron that
    // kept crawling after a refusal is precisely how a shared egress IP gets
    // banned for every other user.
    if (!(await isPublicHttpUrlAsync(url))) { summary.error = "not a public URL"; return summary; }

    const compliance = await checkCompliance(url, { permittedHosts: process.env.PERMITTED_HOSTS || "" });
    if (!compliance.allowed) {
      const consented = compliance.code === "robots_disallowed"
        && await hasScrapeConsent(schedule.user_id, compliance.host);
      if (!consented) {
        summary.error = `compliance: ${compliance.code}`;
        // Pause it rather than failing silently every day forever. The user
        // sees a paused schedule with a reason; a schedule that errors daily
        // and reports nothing is worse than one that stops.
        await store.updateSchedule(schedule.user_id, schedule.id, { status: "paused" });
        summary.paused = true;
        return summary;
      }
    }

    const targetId = schedule.target_id;
    // ── EVERY RUN IS COMMISSIONED LIKE THE FIRST ONE ───────────────────────
    // The schedule carries the intake (migration 0049) precisely so this loop
    // can replay it. A monitor that re-audited a page without its goal,
    // geography and page-type hint would build a trend line whose points were
    // commissioned differently from each other — and the diff below would
    // still be drawn, because nothing in the diff engine knows the context
    // changed. `audit_type` is `rerun`: a monitored run IS a re-audit, and
    // `source: "schedule"` is what separately records that a cron asked for it.
    const created = await store.createAudit(schedule.user_id, {
      targetId, targetUrl: url,
      deviceProfile: schedule.device_profile,
      auditProfile: schedule.audit_profile,
      auditProfileSource: "explicit",
      auditType: "rerun",
      primaryGoal: schedule.primary_goal || null,
      targetGeography: schedule.target_geography || null,
      competitorUrls: schedule.competitor_urls || [],
      pageTypeHint: schedule.page_type_hint || null,
      baselineAuditId: schedule.last_audit_id || null,
      source: "schedule",
    });
    if (!created.ok) { summary.error = "could not open the audit"; return summary; }

    const result = await runAudit(url, {
      deviceProfile: schedule.device_profile,
      auditProfile: schedule.audit_profile,
      auditType: "rerun",
      primaryGoal: schedule.primary_goal || null,
      targetGeography: schedule.target_geography || null,
      competitorUrls: schedule.competitor_urls || [],
      pageTypeHint: schedule.page_type_hint || null,
      ...opts.auditOptions,
    });
    await store.persistResult(schedule.user_id, created.audit.id, result);
    summary.ran = true;
    summary.auditId = created.audit.id;

    // Compare against the previous run, where there was one.
    let diff = null;
    if (schedule.last_audit_id) {
      const prior = await store.getAuditFull(schedule.user_id, schedule.last_audit_id);
      if (prior) {
        const { rehydrate } = await import("./discoverability.js");
        diff = diffAudits(rehydrate(prior), { ...result, auditId: created.audit.id });
      }
    }

    const verdict = shouldAlert(diff, Number(schedule.alert_threshold) || 3);
    if (verdict.alert) {
      const mail = await sendAlert({ schedule, diff, result: { ...result, auditId: created.audit.id }, verdict });
      summary.alerted = mail.sent;
      summary.alertReason = verdict.reason;
      await dispatchAuditEvent(
        schedule.user_id,
        verdict.kind === "regression" ? "audit.regressed" : "audit.completed",
        { audit: created.audit, result, diff },
      );
    }

    await store.markScheduleRun(schedule.id, {
      auditId: created.audit.id, cadence: schedule.cadence,
    });
    await store.recordEvent(schedule.user_id, {
      auditId: created.audit.id,
      eventType: "scheduled_run",
      payload: { scheduleId: schedule.id, alerted: summary.alerted, reason: verdict.reason },
    });
  } catch (err) {
    summary.error = err?.message || "run failed";
  }
  return summary;
}

export const handler = async () => withJobRun(JOB_ID, async () => {
  const due = await store.dueSchedules(new Date(), MAX_SCHEDULES_PER_RUN);
  const results = [];

  // In series, not in parallel. Each schedule is a full audit with its own
  // PageSpeed lookup and rate-limited fetches; fifteen at once would throttle
  // into a timeout holding fourteen half-finished audits.
  for (const s of due) {
    results.push(await runSchedule(s));
  }

  const ran = results.filter((r) => r.ran).length;
  const alerted = results.filter((r) => r.alerted).length;
  const failed = results.filter((r) => r.error).length;

  return {
    statusCode: 200,
    body: JSON.stringify({
      due: due.length, ran, alerted, failed,
      // Reported so a run that hit the cap is visible as capped rather than
      // looking like it processed everything there was.
      capped: due.length >= MAX_SCHEDULES_PER_RUN,
      results,
    }),
  };
});
