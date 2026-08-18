// src/lib/consentService.js — the analytics-consent contract for the React app.
//
// Deliberately knows NOTHING about gtag. It writes localStorage for instant UX,
// delegates the Consent Mode push to window.__datiqConsent (defined in
// public/analytics.js), and mirrors the decision to /api/consent for the audit
// trail. That split is what lets these functions be unit-tested without a gtag
// stub, and lets analytics.js be swapped for a different vendor without
// touching any component.
//
// The localStorage copy is the FAST path (read synchronously in <head> by
// analytics.js, before any network call could return). The database copy is the
// DURABLE path — the record that survives a cleared browser and answers
// "when did this person consent, and under which version of the policy?".
// They are not redundant; neither can do the other's job.

import { getSessionId } from "./usageRepo.js";
import { apiClient } from "./apiClient.js";

export const CONSENT_KEY = "datiq.consent";

/**
 * Bumped whenever the cookie/analytics wording in the Privacy Policy changes
 * materially, so an old consent is distinguishable from one given under the
 * current text. runtime-config.js can override it without a rebuild; the
 * literal here is the fallback if that file failed to load.
 */
export const POLICY_VERSION =
  (typeof window !== "undefined" && window.__DATIQ_RUNTIME__?.consentPolicyVersion) ||
  "2026-08-15";

/** Valid choices. "unset" is represented by the absence of a record, not a value. */
export const GRANTED = "granted";
export const DENIED = "denied";

function isChoice(v) {
  return v === GRANTED || v === DENIED;
}

/**
 * The stored consent record, or null when the visitor has not chosen.
 * A malformed or partially-written record counts as "not chosen" — we re-ask
 * rather than guess, because guessing wrong in the permissive direction is a
 * compliance failure.
 */
export function getConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !isChoice(parsed.analytics)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True once the visitor has made an explicit choice, either way. */
export function hasChosen() {
  return getConsent() !== null;
}

/** True only when analytics are actively allowed. */
export function analyticsAllowed() {
  return getConsent()?.analytics === GRANTED;
}

function readClientId() {
  return new Promise((resolve) => {
    try {
      const api = typeof window !== "undefined" ? window.__datiqConsent : null;
      if (!api?.clientId) return resolve(null);
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v || null); } };
      api.clientId(done);
      // gtag's `get` never calls back if the tag failed to load. Do not let
      // that hang the server write — the consent record matters more than the
      // client id, which is only needed for a later GA-side deletion request.
      setTimeout(() => done(null), 1500);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Mirror the decision to the server. Fire-and-forget by design: a failed or
 * slow network must never block the banner from closing or leave the visitor
 * staring at a spinner over a cookie choice. The localStorage write has
 * already happened by the time this runs, so the user-visible behaviour is
 * correct even if this never lands.
 *
 * user_id is NOT sent — the function resolves it from the JWT. A client that
 * could name its own user_id could write consent records for other people.
 */
async function mirrorToServer(payload) {
  try {
    const gaClientId = await readClientId();
    await apiClient.recordConsent({ ...payload, gaClientId });
  } catch {
    /* never throws — see the doc comment above */
  }
}

/**
 * Record a choice. Writes localStorage, pushes the Consent Mode update, and
 * mirrors to the server.
 *
 * @param {"granted"|"denied"} choice
 * @param {string} [source] where the choice was made: "banner" | "privacy_page"
 * @returns {object|null} the stored record, or null if `choice` was invalid
 */
export function setConsent(choice, source = "banner") {
  if (!isChoice(choice)) return null;

  const record = {
    analytics: choice,
    ts: new Date().toISOString(),
    policyVersion: POLICY_VERSION,
    version: 1,
  };

  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
  } catch {
    // Private mode / quota. The gtag update below still applies for this
    // page view; the visitor will simply be asked again next time.
  }

  try {
    window.__datiqConsent?.set?.(choice);
  } catch {
    /* analytics.js absent (tests, or a build without it) */
  }

  void mirrorToServer({
    analytics: choice,
    source,
    policyVersion: POLICY_VERSION,
    sessionId: safeSessionId(),
  });

  return record;
}

function safeSessionId() {
  try { return getSessionId(); } catch { return "anonymous"; }
}

/**
 * Forget the choice so the banner asks again. This is the "change my mind"
 * path — it deliberately does NOT erase anything, because re-opening the
 * question is not the same act as withdrawing data.
 */
export function clearConsent() {
  try { localStorage.removeItem(CONSENT_KEY); } catch { /* ignore */ }
}

/**
 * Attach the signed-in user to the consent record this browser session already
 * wrote. Called by AuthProvider on SIGNED_IN.
 *
 * Deliberately does NOT re-record a choice: linking an identity to a decision
 * someone already made is a different act from making a new decision, and
 * conflating them would put a fresh "consented today" timestamp on a consent
 * given weeks earlier. The server audits it with source "link" and leaves
 * `analytics` untouched.
 *
 * Best-effort and silent: a visitor who declined analytics should not see an
 * error about analytics on the way into their account.
 *
 * @returns {Promise<{ok: boolean, linked?: boolean}>}
 */
export async function linkConsentToUser() {
  if (!hasChosen()) return { ok: true, linked: false };
  try {
    const data = await apiClient.linkConsent({ sessionId: safeSessionId() });
    return { ok: true, linked: !!data?.linked };
  } catch {
    return { ok: false };
  }
}

/**
 * Withdraw consent AND erase the analytics we hold for this subject.
 *
 * Unlike every other call here this one awaits the server, because the caller
 * is a user pressing "erase my data" and is entitled to know whether it worked.
 *
 * ⚠️ Scope: this erases DatIQ's own analytics_events rows. Data already inside
 * Google Analytics can only be removed through Google's User Deletion API,
 * which needs a Google Cloud service account this project does not yet have —
 * so that remains a manual request in the GA4 admin UI. The Privacy Policy
 * states this distinction rather than implying a completeness we can't deliver.
 *
 * @returns {Promise<{ok: boolean, deleted?: number, error?: string}>}
 */
export async function withdrawAndErase() {
  setConsent(DENIED, "withdrawal");

  try {
    const data = await apiClient.withdrawConsent({ sessionId: safeSessionId() });
    return { ok: true, deleted: Number(data?.deleted ?? 0) };
  } catch (err) {
    return { ok: false, error: err?.message || "Network error" };
  }
}
