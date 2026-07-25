// contactService.js — orchestrates a /contact submission.
//
// Two things happen per submission:
//
//   1. PRIMARY (awaited)   — Web3Forms sends the email. Its success/failure is
//                            what the user sees.
//   2. PARALLEL (detached) — the CRM/automation webhook and the subscriber
//                            capture both fire without blocking the email, and
//                            can never fail the submission.
//
// Both side-channels start BEFORE the email is awaited, so a slow webhook costs
// nothing in wall-clock time.

import {
  WEB3FORMS_ACCESS_KEY,
  WEB3FORMS_ACCESS_KEY_ADMIN,
} from "./config.js";
import {
  INBOX,
  INBOX_EMAIL,
  buildSubject,
  inboxForType,
  labelForType,
  normalizeContactType,
} from "./contactRouting.js";
import { submitToWeb3Forms } from "./web3forms.js";
import { notifyContactWebhook } from "./contactWebhook.js";
import { captureEmail } from "./emailCaptureService.js";

/**
 * Which access key delivers a given inbox. Both inboxes share the default key
 * today; setting VITE_WEB3FORMS_ACCESS_KEY_ADMIN splits admin traffic onto its
 * own key with no other change.
 */
export function accessKeyForInbox(inbox) {
  if (inbox === INBOX.ADMIN && WEB3FORMS_ACCESS_KEY_ADMIN) {
    return WEB3FORMS_ACCESS_KEY_ADMIN;
  }
  return WEB3FORMS_ACCESS_KEY;
}

/** Build the exact field set Web3Forms receives. Pure — used directly in tests. */
export function buildWeb3FormsFields(submission) {
  const type = normalizeContactType(submission.type);
  const inbox = inboxForType(type);
  const routeTo = INBOX_EMAIL[inbox];
  return {
    // Web3Forms reserved fields
    subject: buildSubject(type, submission.subject),
    from_name: "DatIQ Contact Form",
    replyto: submission.email || "",
    botcheck: "",
    // Payload the human reads in the email body
    name: submission.name?.trim() || "(not provided)",
    email: submission.email || "",
    enquiry_type: labelForType(type),
    // Routing metadata: one key delivers both inboxes today, so the receiving
    // mailbox filters on these to forward correctly.
    inbox,
    route_to: routeTo,
    message: submission.message || "",
    source: submission.source || "contact-form",
  };
}

/** mailto: fallback URL, used when Web3Forms delivery fails. */
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
  const send    = deps.submitToWeb3Forms   || submitToWeb3Forms;
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
    await send(buildWeb3FormsFields(enriched), {
      accessKey: accessKeyForInbox(inbox),
    });
    return { ok: true, inbox, routeTo };
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
