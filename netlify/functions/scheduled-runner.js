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

// ── Minimal cron field matcher (supports *, a, a-b, a,b, */n) ─────────────────
function matchField(field, value) {
  if (field === "*" || field === "?") return true;
  return field.split(",").some((part) => {
    const step = part.includes("/") ? parseInt(part.split("/")[1], 10) : 1;
    const range = part.split("/")[0];
    if (range === "*") return value % step === 0;
    if (range.includes("-")) {
      const [lo, hi] = range.split("-").map(Number);
      return value >= lo && value <= hi && (value - lo) % step === 0;
    }
    return Number(range) === value;
  });
}

// Does this 5-field cron match the given UTC date (to the hour)?
function cronMatchesHour(cron, date) {
  const parts = String(cron).trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  // The runner fires hourly; treat the minute field as "this hour" (ignore exact minute).
  return (
    matchField(hour, date.getUTCHours()) &&
    matchField(dom, date.getUTCDate()) &&
    matchField(mon, date.getUTCMonth() + 1) &&
    matchField(dow, date.getUTCDay())
  );
}

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
      const res = await fetch(`${base}/scheduled_tasks?status=eq.active&select=id,data`, { headers });
      if (!res.ok) throw new Error(`list ${res.status}`);
      return res.json();
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

export const handler = async () => {
  const db = sb();
  if (!db) {
    console.log("[DatIQ] scheduled-runner: Supabase service key not configured — skipping.");
    return { statusCode: 200, body: "skipped (no supabase)" };
  }

  const now = new Date();
  let scanned = 0, ran = 0, changed = 0, failed = 0;

  try {
    const rows = await db.listActive();
    for (const row of rows) {
      const schedule = { ...(row.data || {}), id: row.id };
      if (!schedule.cron || !schedule.target) continue;
      scanned++;
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

  const summary = `scanned ${scanned}, ran ${ran}, changed ${changed}, failed ${failed}`;
  console.log("[DatIQ] scheduled-runner:", summary);
  return { statusCode: 200, body: summary };
};
