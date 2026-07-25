// contactService.js — orchestrates a /contact submission.
//
// Two things happen per submission:
//
//   1. PRIMARY (awaited)   — POST /api/contact-email sends the mail through
//                            Resend, server-side. Its success/failure is what
//                            the user sees.
//   2. PARALLEL (detached) — the CRM/automation webhook and the subscriber
//                            capture both fire without blocking the email, and
//                            can never fail the submission.
//
// Both side-channels start BEFORE the email is awaited, so a slow webhook costs
// nothing in wall-clock time.
//
// The browser never names a recipient. It sends an enquiry *type*; the function
// resolves the destination from the same routing table used to label the form,
// so the endpoint can't be turned into an open relay. The inbox values below are
// for display and telemetry only — the server's decision is the one that ships.

import {
  INBOX_EMAIL,
  buildSubject,
  inboxForType,
  labelForType,
  normalizeContactType,
} from "./contactRouting.js";
import { apiClient } from "./apiClient.js";
import { notifyContactWebhook } from "./contactWebhook.js";
import { captureEmail } from "./emailCaptureService.js";

/** Build the request body for POST /api/contact-email. Pure — used in tests. */
export function buildContactPayload(submission) {
  const type = normalizeContactType(submission.type);
  return {
    type,
    name: submission.name?.trim() || "",
    email: submission.email || "",
    subject: submission.subject?.trim() || "",
    message: submission.message || "",
    source: submission.source || "contact-form",
    // Honeypot. A real browser never fills this; the function 200s and drops
    // the message when it arrives non-empty.
    botcheck: "",
  };
}

/** mailto: fallback URL, used when server-side delivery fails. */
export function buildMailtoFallback(submission) {
  const type = normalizeContactType(submission.type);
  const body = [
    `Name: ${submission.name?.trim() || "(not provided)"}`,
    `Email: ${submission.email || ""}`,
    `Type: ${labelForType(type)}`,
    "",
    submission.message || "",
  ].join("\n");
  return (
    `mailto:${INBOX_EMAIL[inboxForType(type)]}` +
    `?subject=${encodeURIComponent(buildSubject(type, submission.subject))}` +
    `&body=${encodeURIComponent(body)}`
  );
}

/**
 * Submit a contact enquiry.
 *
 * @param {object} submission {type, name, email, subject, message, source}
 * @param {object} [deps]     Injectable collaborators, for tests.
 * @returns {Promise<{ok: boolean, inbox: string, routeTo: string,
 *                    error?: string, mailto?: string}>}
 */
export async function submitContactForm(submission, deps = {}) {
  const send    = deps.sendContactEmail     || apiClient.sendContactEmail;
  const hook    = deps.notifyContactWebhook || notifyContactWebhook;
  const capture = deps.captureEmail         || captureEmail;

  const type    = normalizeContactType(submission.type);
  const inbox   = inboxForType(type);
  const routeTo = INBOX_EMAIL[inbox];
  const enriched = { ...submission, type, inbox, routeTo };

  // ── Parallel, detached. Never awaited, never allowed to reject. ────────────
  swallow(hook(enriched));
  if (submission.email) swallow(capture(submission.email, `contact-form:${type}`));

  // ── Primary: the email itself. ─────────────────────────────────────────────
  try {
    // Trust the server's routing over the local guess — they agree today, and
    // if they ever diverge the address that actually received the mail wins.
    const res = await send(buildContactPayload(enriched));
    return {
      ok: true,
      inbox:   res?.inbox   || inbox,
      routeTo: res?.routeTo || routeTo,
    };
  } catch (err) {
    return {
      ok: false,
      inbox,
      routeTo,
      error: err?.message || "Delivery failed.",
      mailto: buildMailtoFallback(enriched),
    };
  }
}

// Attach a no-op catch so a rejected side-channel can't surface as an
// unhandled rejection and take the page's error overlay with it.
function swallow(maybePromise) {
  if (maybePromise && typeof maybePromise.catch === "function") {
    maybePromise.catch(() => {});
  }
}
