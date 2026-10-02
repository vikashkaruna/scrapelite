// health-monitor.js — hourly service health sampler + state-change alerting.
//
// Two jobs, and the second one is why this is a cron rather than something the
// admin page does on load:
//
//   1. Store one health_samples row per component, every hour. Uptime and
//      latency benchmarks need a time series, and a dashboard that only samples
//      when a human is looking measures when humans look, not when things break.
//   2. Email when a CRITICAL component changes state. An outage at 3am that
//      nobody sees until someone opens a browser is not monitored.
//
// ── SHIPS DISARMED ───────────────────────────────────────────────────────────
// No OPS_ALERT_EMAIL → no mail, ever. Sampling still runs. Same posture as
// billing-purge: the observing half is safe to turn on immediately, the half
// that reaches out to a human is opt-in.
//
// ── ALERTS ONLY ON TRANSITIONS ───────────────────────────────────────────────
// The alert fires when the newest status differs from the previous sample's,
// which makes it naturally idempotent: a component that stays down produces one
// email, not one an hour. This is deliberately NOT the reengagement.js pattern
// (anchoring a dedup window on today), which mails the same user daily forever
// — see the note in 0017_billing_lifecycle.sql.

import { runAllProbes } from "./lib/healthProbes.js";
import { withJobRun } from "./lib/jobControl.js";
import {
  classifyProbe, summarizeHealth, componentById, HEALTH_STATUS, healthStatusMeta,
} from "../../src/lib/healthModel.js";
import { wrapEmail } from "../../src/lib/emailBranding.js";
import { mailReady, sendMail } from "./lib/mailTransport.js";

// NOTE: this `config` export does NOT register the cron — it is only honoured
// for v2 functions (`export default`), and this is a v1 handler. The real
// schedule lives in netlify.toml under [functions."health-monitor"]. Keep both
// in sync; netlify.toml is authoritative.
export const config = { schedule: "@hourly" };

function db() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  };
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 5000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The most recent stored status per component, for transition detection. */
async function previousStatuses(d) {
  try {
    // One query for the recent window rather than one per component; the first
    // row seen for a component is its latest because of the ordering.
    const since = new Date(Date.now() - 72 * 3600_000).toISOString();
    const res = await fetchWithTimeout(
      `${d.base}/health_samples?select=component,status,observed_at` +
        `&observed_at=gte.${encodeURIComponent(since)}&order=observed_at.desc&limit=2000`,
      { headers: d.headers },
    );
    if (!res.ok) return {};
    const rows = await res.json().catch(() => []);
    const out = {};
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!(r.component in out)) out[r.component] = r.status;
    }
    return out;
  } catch {
    return {};
  }
}

async function storeSamples(d, components) {
  const rows = components.map((c) => ({
    component: c.id,
    status: c.status,
    latency_ms: Number.isFinite(c.latencyMs) ? Math.round(c.latencyMs) : null,
    observed_at: c.checkedAt || new Date().toISOString(),
    detail: c.note ? { note: String(c.note).slice(0, 300) } : {},
  }));
  const res = await fetchWithTimeout(`${d.base}/health_samples`, {
    method: "POST",
    headers: { ...d.headers, Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  return res.ok ? rows.length : 0;
}

/**
 * Which components changed state since the previous sample?
 *
 * Exported and pure so the alerting rule is testable without a database.
 * Rules, in order:
 *   • No previous status → NOT a transition. The first sample after a deploy
 *     would otherwise page someone about every unconfigured service at once.
 *   • Into or out of `unknown` → NOT a transition. That is a change in what we
 *     could measure, not in the service.
 *   • Non-critical components → not alertable. They still get sampled.
 */
export function detectTransitions(components, previous = {}) {
  const out = [];
  for (const c of components) {
    const prev = previous[c.id];
    if (!prev) continue;
    if (prev === c.status) continue;
    if (prev === HEALTH_STATUS.UNKNOWN || c.status === HEALTH_STATUS.UNKNOWN) continue;
    const meta = componentById(c.id);
    if (!meta?.critical) continue;
    out.push({
      id: c.id,
      label: c.label,
      from: prev,
      to: c.status,
      // A move up the severity scale is a regression; the other way is a recovery.
      recovered: c.status === HEALTH_STATUS.OK,
      note: c.note || "",
      latencyMs: c.latencyMs,
    });
  }
  return out;
}

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

export function buildAlertEmail(transitions, summary, siteUrl) {
  const worst = transitions.some((t) => !t.recovered);
  const title = worst ? "Service degradation detected" : "Services recovered";
  const rows = transitions
    .map((t) => {
      const from = healthStatusMeta(t.from).label;
      const to = healthStatusMeta(t.to).label;
      return (
        `<tr><td style="padding:6px 14px 6px 0;color:#111827;font-size:13px;font-weight:600">${escapeHtml(t.label)}</td>` +
        `<td style="padding:6px 0;color:#6b7280;font-size:13px">${escapeHtml(from)} → <strong style="color:${t.recovered ? "#047857" : "#b91c1c"}">${escapeHtml(to)}</strong>` +
        `${t.note ? ` — ${escapeHtml(t.note)}` : ""}</td></tr>`
      );
    })
    .join("");

  return (
    `<div style="font-size:12px;letter-spacing:.05em;color:#6b7280;text-transform:uppercase">Platform health</div>` +
    `<h1 style="margin:3px 0 16px;font-size:20px;font-weight:800;color:#1f2330">${escapeHtml(title)}</h1>` +
    `<table style="border-collapse:collapse;margin-bottom:16px;width:100%">${rows}</table>` +
    `<p style="margin:0 0 16px;color:#374151;font-size:13px">` +
    `${summary.ok} operational · ${summary.degraded} degraded · ${summary.down} down · ${summary.unknown} not checked.</p>` +
    `<a href="${escapeHtml(siteUrl)}/admin/health" style="display:inline-block;background:#4f46e5;color:#fff;` +
    `text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:9px">Open the health dashboard →</a>` +
    `<p style="margin:18px 0 0;color:#9ca3af;font-size:12px">` +
    `Sent because OPS_ALERT_EMAIL is set. Only critical components trigger this, and only when their state changes.</p>`
  );
  // An OPERATOR alert, not a customer email — but it is still mail sent by
  // DatIQ, so it wears the same shell. One rule with no exceptions is easier
  // to keep true than one with a carve-out nobody remembers.
  return wrapEmail(body, { accent: worst ? "#b91c1c" : "#047857", preheader: title });
}

async function sendAlert(transitions, summary) {
  const to = process.env.OPS_ALERT_EMAIL || "";
  // Disarmed unless a recipient is present and a mail transport is configured.
  if (!to || !mailReady() || !transitions.length) return false;

  const from = process.env.ALERT_EMAIL_FROM || "DatIQ Alerts <alerts@datiq.app>";
  const siteUrl = process.env.URL || process.env.SITE_URL || "https://datiq.app";
  const worst = transitions.some((t) => !t.recovered);

  try {
    const r = await sendMail({
      from,
      to: to.split(",").map((s) => s.trim()).filter(Boolean),
      subject: worst
        ? `DatIQ — ${transitions.filter((t) => !t.recovered).map((t) => t.label).join(", ")} degraded`
        : `DatIQ — services recovered`,
      html: buildAlertEmail(transitions, summary, siteUrl),
    });
    if (!r.ok) {
      console.warn(`[health-monitor] alert email failed (${r.status})`);
      return false;
    }
    return true;
  } catch (err) {
    // Defensive: sendMail maps transport failures to its result, never throws.
    console.warn("[health-monitor] alert email error:", err.message);
    return false;
  }
}

const run = async () => {
  const raw = await runAllProbes();
  const components = raw.map(classifyProbe);
  const summary = summarizeHealth(components);

  const d = db();
  if (!d) {
    const msg = `probed ${components.length} components (overall ${summary.overall}); not stored — Supabase not configured`;
    console.log(`[health-monitor] ${msg}`);
    return { statusCode: 200, body: msg };
  }

  const previous = await previousStatuses(d);
  const transitions = detectTransitions(components, previous);

  let stored = 0;
  try { stored = await storeSamples(d, components); }
  catch (err) { console.warn("[health-monitor] sample write failed:", err.message); }

  const emailed = await sendAlert(transitions, summary);

  const msg =
    `overall ${summary.overall}; ${summary.ok} ok, ${summary.degraded} degraded, ` +
    `${summary.down} down, ${summary.unknown} unchecked; stored ${stored}; ` +
    `${transitions.length} transition(s)${emailed ? " (alert sent)" : ""}`;
  console.log(`[health-monitor] ${msg}`);
  return { statusCode: 200, body: msg };
};

export const handler = withJobRun("health-monitor", run);

export const _internal = { detectTransitions, previousStatuses, storeSamples, sendAlert, buildAlertEmail, run };
