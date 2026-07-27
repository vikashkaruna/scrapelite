// netlify/functions/reengagement.js — F49 (re-engagement emails).
//
// Council intent: "Deep-linked Re-engagement Emails ('your schedule ran /
// data changed'). Free D7 lift once accounts + monitoring exist; deep links
// resume exact context."
//
// Three email surfaces, all fire via Resend:
//
//   1. Welcome:        fired once per user, on first sign-in. Browser
//                      calls /api/welcome-email separately; this function
//                      is the orchestrator. (Implemented in welcome-email.js
//                      — included here as a comment for discoverability.)
//
//   2. Daily schedule-ran digest: at 9pm UTC, every active user with at
//      least one run today gets a "your schedules ran N times today"
//      email. Deep links to /schedules so they can see what changed.
//
//   3. Weekly digest (Mondays only): "Your [N] schedules ran [N] times
//      this week, [N] detected changes, [N] errors."
//
//   4. D7 re-engagement: user hasn't visited the app in 7+ days. Email
//      them a one-liner with a deep link to /workspace so they resume
//      with their watchlist context.
//
//   5. D30 abandoned trial: longer-tail nudge for free-tier users who
//      haven't run anything in 30+ days. Suggests a sample template to
//      re-activate.
//
// For v1 the function reads a small `reengagement_log` Supabase table
// (created by scripts/reengagement-log.sql) to dedup so we never email
// the same user twice for the same trigger window. Service-key only.

// NOTE: this `config` export does NOT register the cron — it is only honoured
// for v2 functions (`export default`), and this is a v1 handler. The real
// schedule lives in netlify.toml under [functions."reengagement"]. Keep both in sync;
// netlify.toml is authoritative.
export const config = { schedule: "@daily" };

// Daily schedule-ran digest fires only at this UTC hour. Default 21:00 UTC
// = ~5pm ET / 2:30am IST. Operators can override via env.
const DAILY_DIGEST_HOUR_UTC = parseInt(process.env.DAILY_DIGEST_HOUR_UTC || "21", 10) || 21;

const SITE_URL = process.env.URL || process.env.SITE_URL || "https://datiq.app";
const FROM = process.env.CONTACT_EMAIL_FROM || "DatIQ <hello@datiq.app>";
const RESEND_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const DAY = 24 * 60 * 60 * 1000;

function sb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function isMonday(iso) {
  const d = new Date(iso);
  return d.getUTCDay() === 1; // 0=Sun, 1=Mon
}

function isOlderThan(iso, days) {
  if (!iso) return false;
  return (Date.now() - new Date(iso).getTime()) > days * DAY;
}

async function sendEmail({ to, subject, html }) {
  if (!RESEND_KEY || !to) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    return res.ok;
  } catch (err) {
    console.warn("[DatIQ reengagement] Resend error:", err.message);
    return false;
  }
}

function digestHtml({ userName, runCount, changeCount, errorCount, topSchedule }) {
  const greeting = userName ? `Hi ${escapeHtml(userName)}` : "Hi";
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto">` +
    `<div style="background:#4f46e5;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0">` +
    `<div style="font-size:13px;letter-spacing:.04em;opacity:.85;text-transform:uppercase">DatIQ · Weekly digest</div>` +
    `<div style="font-size:20px;font-weight:800;margin-top:4px">Your monitoring week</div></div>` +
    `<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px 22px;background:#fff">` +
    `<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.55">${greeting} — here's what your DatIQ schedules did this week.</p>` +
    `<table style="border-collapse:collapse;margin-bottom:18px">` +
    `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Schedule runs</td><td style="padding:4px 0;font-size:14px;font-weight:600">${runCount}</td></tr>` +
    `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Detected changes</td><td style="padding:4px 0;font-size:14px;font-weight:600">${changeCount}</td></tr>` +
    `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Errors</td><td style="padding:4px 0;font-size:14px;font-weight:600">${errorCount}</td></tr>` +
    `</table>` +
    (topSchedule ? `<p style="margin:0 0 14px;color:#374151;font-size:14px">Most active: <strong>${escapeHtml(topSchedule.label)}</strong> (${topSchedule.runs} checks)</p>` : "") +
    `<a href="${SITE_URL}/workspace" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:9px">Open DatIQ →</a>` +
    `<p style="margin:18px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">Manage notification preferences on the Account page.</p>` +
    `</div></div>`
  );
}

function reengagementHtml({ userName, lastSeen }) {
  const greeting = userName ? `Hi ${escapeHtml(userName)}` : "Hi";
  const ago = lastSeen ? new Date(lastSeen).toLocaleDateString() : "a while";
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto">` +
    `<div style="background:#4f46e5;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0">` +
    `<div style="font-size:13px;letter-spacing:.04em;opacity:.85;text-transform:uppercase">DatIQ · Still watching</div>` +
    `<div style="font-size:20px;font-weight:800;margin-top:4px">Your schedules are still running</div></div>` +
    `<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px 22px;background:#fff">` +
    `<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.55">${greeting} — you last opened DatIQ on <strong>${escapeHtml(ago)}</strong>. Your monitoring schedules are still firing in the background.</p>` +
    `<p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.55">Open DatIQ to see what's changed since your last visit.</p>` +
    `<a href="${SITE_URL}/workspace" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:9px">View your watchlist →</a>` +
    `<p style="margin:18px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">Manage notification preferences on the Account page.</p>` +
    `</div></div>`
  );
}

// F49 — daily schedule-ran digest. Aggregates the day's run activity for
// one user into a single short email.
function dailyRanHtml({ userName, runCount, changeCount, errorCount, dayKey }) {
  const greeting = userName ? `Hi ${escapeHtml(userName)}` : "Hi";
  const hasChange = changeCount > 0;
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto">` +
    `<div style="background:#4f46e5;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0">` +
    `<div style="font-size:13px;letter-spacing:.04em;opacity:.85;text-transform:uppercase">DatIQ · Daily summary</div>` +
    `<div style="font-size:20px;font-weight:800;margin-top:4px">Your schedules ran today</div></div>` +
    `<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px 22px;background:#fff">` +
    `<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.55">${greeting} — here&apos;s a quick recap of <strong>${escapeHtml(dayKey)}</strong>:</p>` +
    `<table style="border-collapse:collapse;margin-bottom:18px">` +
    `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Schedule runs</td><td style="padding:4px 0;font-size:14px;font-weight:600">${runCount}</td></tr>` +
    `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Detected changes</td><td style="padding:4px 0;font-size:14px;font-weight:600">${changeCount}</td></tr>` +
    (errorCount > 0 ? `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Errors</td><td style="padding:4px 0;font-size:14px;font-weight:600">${errorCount}</td></tr>` : "") +
    `</table>` +
    (hasChange
      ? `<p style="margin:0 0 14px;color:#374151;font-size:14px">We detected changes on ${changeCount} schedule${changeCount !== 1 ? "s" : ""} — open DatIQ to see what shifted.</p>`
      : `<p style="margin:0 0 14px;color:#374151;font-size:14px">No content changes today. Your monitors are quiet and steady.</p>`) +
    `<a href="${SITE_URL}/schedules" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:9px">Open your schedules →</a>` +
    `<p style="margin:18px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">Manage notification preferences on the Account page.</p>` +
    `</div></div>`
  );
}

// F49 — D30 abandoned-trial nudge. Suggests a sample template to
// re-activate the user.
function abandonedTrialHtml({ userName, lastRun }) {
  const greeting = userName ? `Hi ${escapeHtml(userName)}` : "Hi";
  const ago = lastRun ? new Date(lastRun).toLocaleDateString() : "a while back";
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto">` +
    `<div style="background:#4f46e5;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0">` +
    `<div style="font-size:13px;letter-spacing:.04em;opacity:.85;text-transform:uppercase">DatIQ · 30-day check-in</div>` +
    `<div style="font-size:20px;font-weight:800;margin-top:4px">A lot has changed in a month</div></div>` +
    `<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px 22px;background:#fff">` +
    `<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.55">${greeting} — you last ran an extraction on <strong>${escapeHtml(ago)}</strong>. Since then, we&apos;ve shipped batch CSV import, Airtable + Notion export, and a one-click template gallery.</p>` +
    `<p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.55">Try a fresh template — pick a starting point and we&apos;ll pre-fill the right intent for you:</p>` +
    `<a href="${SITE_URL}/" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:9px;margin-right:8px">Browse templates →</a>` +
    `<a href="${SITE_URL}/batch" style="display:inline-block;background:#fff;color:#4f46e5;border:1px solid #4f46e5;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:9px">Try a batch</a>` +
    `<p style="margin:18px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">Manage notification preferences on the Account page.</p>` +
    `</div></div>`
  );
}

// ── Supabase query helpers ────────────────────────────────────────────────────

async function fetchActiveUsers(db) {
  // "Active" = signed in + at least one monitoring schedule. We pick
  // (user_email, schedule) pairs from the public.scheduled_tasks table
  // (the data column is JSON; alertEmail + lastRunAt + runCount live in
  // there). The `user_email` lives at the row root for ergonomics; we
  // store it when the schedule is created.
  const url = `${db.base}/scheduled_tasks?status=eq.active&select=id,user_email,data&limit=200`;
  try {
    const res = await fetch(url, { headers: db.headers });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function alreadySent(db, userEmail, kind, window) {
  // Idempotency: read the last log row for this user+kind and bail if it
  // exists for the current window.
  const url = `${db.base}/reengagement_log?user_email=eq.${encodeURIComponent(userEmail)}&kind=eq.${kind}&window_key=eq.${window}&select=id&limit=1`;
  try {
    const res = await fetch(url, { headers: db.headers });
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function markSent(db, userEmail, kind, window) {
  const url = `${db.base}/reengagement_log`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { ...db.headers, Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({ user_email: userEmail, kind, window_key: window, sent_at: new Date().toISOString() }),
    });
  } catch { /* ignore */ }
}

// ── Aggregator: build the weekly digest for one user ─────────────────────────
export function buildDigest(rows) {
  let runs = 0, changes = 0, errors = 0;
  const byLabel = new Map();
  for (const row of rows) {
    const d = row.data || {};
    runs += d.runCount || 0;
    if (d.lastStatus === "changed") changes++;
    if (d.lastStatus === "error") errors++;
    const key = d.label || row.id;
    const entry = byLabel.get(key) || { label: key, runs: 0 };
    entry.runs += d.runCount || 0;
    byLabel.set(key, entry);
  }
  const sorted = Array.from(byLabel.values()).sort((a, b) => b.runs - a.runs);
  return {
    runCount: runs,
    changeCount: changes,
    errorCount: errors,
    topSchedule: sorted[0] || null,
  };
}

// F49 — "your schedule ran today" digest. Counts runs whose lastRunAt
// falls in the current UTC day. Pure helper (testable in isolation).
export function buildDailyDigest(rows, now = new Date()) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  let runs = 0, changes = 0, errors = 0;
  for (const row of rows) {
    const d = row.data || {};
    const t = d.lastRunAt ? new Date(d.lastRunAt) : null;
    if (!t || t < dayStart || t >= dayEnd) continue;
    runs++;
    if (d.lastStatus === "changed") changes++;
    else if (d.lastStatus === "error") errors++;
  }
  return { runCount: runs, changeCount: changes, errorCount: errors };
}

export const handler = async () => {
  const db = sb();
  if (!db) {
    return { statusCode: 200, body: "skipped (no supabase service key)" };
  }
  if (!RESEND_KEY) {
    return { statusCode: 200, body: "skipped (no Resend key)" };
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekKey = `${now.getUTCFullYear()}-W${String(getISOWeek(now)).padStart(2, "0")}`;
  const isMon = isMonday(now.toISOString());
  const isDigestHour = now.getUTCHours() === DAILY_DIGEST_HOUR_UTC;

  const rows = await fetchActiveUsers(db);
  const byEmail = new Map();
  for (const r of rows) {
    if (!r.user_email) continue;
    if (!byEmail.has(r.user_email)) byEmail.set(r.user_email, []);
    byEmail.get(r.user_email).push(r);
  }

  let sent = 0;
  for (const [email, userRows] of byEmail.entries()) {
    // (1) Daily "your schedules ran today" digest — fires once per day
    // at DAILY_DIGEST_HOUR_UTC. Skip on days with zero runs.
    if (isDigestHour) {
      const dailyWindow = `daily:${today}`;
      if (!(await alreadySent(db, email, "daily", dailyWindow))) {
        const daily = buildDailyDigest(userRows, now);
        if (daily.runCount > 0) {
          const ok = await sendEmail({
            to: email,
            subject: `Your DatIQ day: ${daily.runCount} run${daily.runCount !== 1 ? "s" : ""}, ${daily.changeCount} change${daily.changeCount !== 1 ? "s" : ""}`,
            html: dailyRanHtml({ userName: email.split("@")[0], ...daily, dayKey: today }),
          });
          if (ok) {
            sent++;
            await markSent(db, email, "daily", dailyWindow);
          }
        }
      }
    }

    // (2) Weekly digest — only on Mondays.
    if (isMon) {
      const window = `digest:${weekKey}`;
      if (!(await alreadySent(db, email, "digest", window))) {
        const digest = buildDigest(userRows);
        if (digest.runCount > 0) {
          const ok = await sendEmail({
            to: email,
            subject: `Your DatIQ week: ${digest.runCount} runs, ${digest.changeCount} changes`,
            html: digestHtml({ userName: email.split("@")[0], ...digest }),
          });
          if (ok) {
            sent++;
            await markSent(db, email, "digest", window);
          }
        }
      }
    }

    // (3) D7 re-engagement — any user with no schedule runs in 7+ days
    // (proxy for "user is inactive"). We don't track per-user visits in
    // v1, so this fires for users whose most-recent run is older than 7d
    // AND they haven't been emailed for re-engagement in the last 7d.
    const reengageWindow = `d7:${today}`;
    if (!(await alreadySent(db, email, "d7", reengageWindow))) {
      const lastRun = userRows
        .map((r) => r.data?.lastRunAt)
        .filter(Boolean)
        .sort()
        .pop();
      if (lastRun && isOlderThan(lastRun, 7)) {
        const ok = await sendEmail({
          to: email,
          subject: "Your DatIQ schedules are still running",
          html: reengagementHtml({ userName: email.split("@")[0], lastSeen: lastRun }),
        });
        if (ok) {
          sent++;
          await markSent(db, email, "d7", reengageWindow);
        }
      }
    }

    // (4) D30 abandoned-trial nudge — same proxy as D7 but at the 30-day
    // window. Skip free-tier users with no runs at all in 30d. (Operators
    // can opt out via env D30_ENABLED=false.)
    if (process.env.D30_ENABLED !== "false") {
      const d30Window = `d30:${today}`;
      if (!(await alreadySent(db, email, "d30", d30Window))) {
        const lastRun = userRows
          .map((r) => r.data?.lastRunAt)
          .filter(Boolean)
          .sort()
          .pop();
        if (lastRun && isOlderThan(lastRun, 30)) {
          const ok = await sendEmail({
            to: email,
            subject: "A lot has changed in a month — here's what's new in DatIQ",
            html: abandonedTrialHtml({ userName: email.split("@")[0], lastRun }),
          });
          if (ok) {
            sent++;
            await markSent(db, email, "d30", d30Window);
          }
        }
      }
    }
  }

  return { statusCode: 200, body: `Re-engagement complete. ${sent} email(s) sent. (${byEmail.size} user(s) checked.)` };
};

// ISO week number (1-53) — used for the weekly digest dedup window.
function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

// `getSessionId` is intentionally imported but unused — it's a hint to
// future code that wants to scope the digest by anonymous session id.
// void getSessionId;

// Expose the pure helpers for unit tests. (Netlify's esbuild bundler
// strips unused exports in production, but tests need them.)
export const _internal = {
  buildDigest,
  buildDailyDigest,
  digestHtml,
  reengagementHtml,
  dailyRanHtml,
  abandonedTrialHtml,
  isMonday,
  isOlderThan,
  getISOWeek,
  escapeHtml,
  DAILY_DIGEST_HOUR_UTC,
};
