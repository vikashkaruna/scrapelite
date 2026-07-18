// src/lib/integrationsNotify.js — F18 (Notify-me for Airtable / Notion exports).
//
// Council intent: "Google Sheets / Airtable / Notion Export Integrations.
// Where extracted data actually lives for non-technical personas; cheapest
// 'integrations' checkbox."
//
// v1 scope (OAuth-free per user decision):
//   - Google Sheets: shipped via the existing `openInGoogleSheets()` deep
//     link (CSV download + new-tab open of Google Drive's "create sheet"
//     page). User pastes/uploads the file.
//   - Airtable + Notion: NOT built as OAuth exports (would need each
//     provider's OAuth + token storage, which is multi-day work). Instead,
//     we ship a "Notify me" CTA that captures the user's email and adds
//     it to a waitlist in localStorage + the email-capture service.
//
// When the waitlist hits a threshold (or in a future v2.0), we wire the
// real OAuth flow and email the waitlisters.

import { captureEmail } from "./emailCaptureService.js";

const WAITLIST_KEY = "datiq.integrationWaitlist";
const NOTIFY_SOURCES = {
  airtable: "Airtable",
  notion: "Notion",
};

function lsRead() {
  try { return JSON.parse(localStorage.getItem(WAITLIST_KEY)) || {}; } catch { return {}; }
}
function lsWrite(value) {
  try { localStorage.setItem(WAITLIST_KEY, JSON.stringify(value)); } catch { /* skip */ }
}

export function getWaitlistedIntegrations() {
  return new Set(Object.keys(lsRead()));
}

export function isWaitlisted(slug) {
  return getWaitlistedIntegrations().has(slug);
}

export async function notifyMeWhenAvailable(slug, email) {
  if (!NOTIFY_SOURCES[slug]) {
    throw new Error(`Unknown integration: ${slug}`);
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Valid email required");
  }
  // Persist locally so the UI can show "you're on the list".
  const all = lsRead();
  all[slug] = { email, at: new Date().toISOString() };
  lsWrite(all);
  // Fire the email-capture pipeline (localStorage + n8n webhook if configured).
  try {
    await captureEmail(email, `integration-waitlist:${slug}`);
  } catch { /* captureEmail is best-effort */ }
  return { ok: true, slug, source: NOTIFY_SOURCES[slug] };
}

export const _internal = { NOTIFY_SOURCES, WAITLIST_KEY };
