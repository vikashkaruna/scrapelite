// alertService.js — metering alert configuration and threshold-based email notifications.
// Users configure thresholds (e.g. 80%, 95%). When crossed, an email is sent once
// per threshold per month via the registered email.

import { WEBHOOK_URL } from "./config.js";
import { syncAlertsToDb } from "./usageRepo.js";

const ALERT_CONFIG_KEY   = "scrapelite.alertConfig";
const ALERTED_KEY        = "scrapelite.alertedThresholds"; // tracks which thresholds fired per month

function ls(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function lsSet(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

const DEFAULTS = {
  enabled:    false,
  email:      "",
  thresholds: [80, 95],
  notifyOn:   { extractions: true, enrichments: false },
};

export function getAlertConfig() {
  const saved = ls(ALERT_CONFIG_KEY);
  return saved ? { ...DEFAULTS, ...saved } : { ...DEFAULTS };
}

export function saveAlertConfig(config) {
  lsSet(ALERT_CONFIG_KEY, config);
  syncAlertsToDb(config).catch(() => {}); // fire-and-forget sync
}

// ── Threshold tracking ────────────────────────────────────────────────────────
function getAlerted() { return ls(ALERTED_KEY) ?? {}; }
function setAlerted(state) { lsSet(ALERTED_KEY, state); }

function wasAlerted(month, threshold) {
  return (getAlerted()[month] ?? []).includes(threshold);
}
function markAlerted(month, threshold) {
  const state = getAlerted();
  if (!state[month]) state[month] = [];
  if (!state[month].includes(threshold)) state[month].push(threshold);
  setAlerted(state);
  // Prune older than 3 months
  const months = Object.keys(state).sort();
  months.slice(0, Math.max(0, months.length - 3)).forEach((m) => delete state[m]);
  setAlerted(state);
}

// ── Notification sending ──────────────────────────────────────────────────────
async function sendAlertNotification(email, payload) {
  // Prefer the configured webhook (n8n / Zapier / Make)
  if (WEBHOOK_URL) {
    try {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "usage_alert", email, ...payload }),
      });
      return;
    } catch (err) {
      console.warn("[ScrapeLite] Alert webhook failed:", err?.message);
    }
  }
  // Fallback: open mailto
  const subject = `ScrapeLite — Usage Alert (${payload.pct}% of ${payload.planName} plan used)`;
  const body =
    `Hi,\n\nYou've used ${payload.pct}% of your ${payload.planName} plan this month.\n` +
    `Extractions: ${payload.used} / ${payload.total}\nMonth: ${payload.month}\n\n` +
    `Upgrade or purchase a top-up bundle at https://scrapelite.netlify.app/pricing`;
  try {
    window.open(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  } catch {}
}

// ── Main check ────────────────────────────────────────────────────────────────
// Called after every extraction/enrichment. Fires notifications for any newly-crossed thresholds.
export async function checkAndFireAlerts(usage, plan, subscription) {
  const config = getAlertConfig();
  if (!config.enabled || !config.email.trim()) return;
  if (!config.notifyOn?.extractions) return;

  const limit = plan?.limits?.extractions;
  if (!limit || limit === Infinity) return; // no alerts for unlimited plans

  const totalLimit = limit + (subscription?.bonusExtractions ?? 0);
  if (totalLimit <= 0) return;

  const pct = Math.round((usage.extractions / totalLimit) * 100);
  const month = usage.month;

  for (const threshold of (config.thresholds ?? [])) {
    if (pct >= threshold && !wasAlerted(month, threshold)) {
      await sendAlertNotification(config.email, {
        threshold,
        used:     usage.extractions,
        total:    totalLimit,
        pct,
        month,
        planName: plan.name,
      });
      markAlerted(month, threshold);
    }
  }
}
