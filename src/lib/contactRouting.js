// contactRouting.js — single source of truth for /contact enquiry types and
// which of the two DatIQ inboxes each one belongs to.
//
// DatIQ runs exactly two customer-facing addresses:
//
//   hello@datiq.app  — product support, bug reports, feature requests, billing
//                      questions, and anything else general.
//   admin@datiq.app  — enterprise/agency enquiries, legal & terms, and
//                      privacy/DPDP matters (incl. the DPDP grievance officer).
//
// Nothing else should be printed anywhere customer-facing. The production
// readiness audit enforces that.

export const INBOX = {
  HELLO: "hello",
  ADMIN: "admin",
};

export const INBOX_EMAIL = {
  [INBOX.HELLO]: "hello@datiq.app",
  [INBOX.ADMIN]: "admin@datiq.app",
};

export const INBOX_LABEL = {
  [INBOX.HELLO]: "Product, billing & general support",
  [INBOX.ADMIN]: "Enterprise, legal & privacy",
};

// Subject prefix stamped on outgoing mail so a single receiving mailbox can
// filter/forward by inbox while both routes still share one Web3Forms key.
export const INBOX_TAG = {
  [INBOX.HELLO]: "HELLO",
  [INBOX.ADMIN]: "ADMIN",
};

export const CONTACT_TYPES = [
  { value: "support",    label: "Product support",     icon: "help-circle",     inbox: INBOX.HELLO },
  { value: "bug",        label: "Bug report",          icon: "alert-triangle",  inbox: INBOX.HELLO },
  { value: "billing",    label: "Billing question",    icon: "credit-card",     inbox: INBOX.HELLO },
  { value: "feature",    label: "Feature request",     icon: "lightbulb",       inbox: INBOX.HELLO },
  { value: "enterprise", label: "Enterprise / agency", icon: "briefcase",       inbox: INBOX.ADMIN },
  { value: "legal",      label: "Legal & terms",       icon: "file",            inbox: INBOX.ADMIN },
  { value: "privacy",    label: "Privacy & DPDP",      icon: "shield",          inbox: INBOX.ADMIN },
  { value: "other",      label: "Other",               icon: "message-square",  inbox: INBOX.HELLO },
];

export const DEFAULT_CONTACT_TYPE = "support";

export const CONTACT_TYPE_BY_VALUE = Object.fromEntries(
  CONTACT_TYPES.map((t) => [t.value, t])
);

/** True when `value` is a known enquiry type. */
export function isContactType(value) {
  return Object.prototype.hasOwnProperty.call(CONTACT_TYPE_BY_VALUE, value);
}

/**
 * Normalise an arbitrary (URL query, stored) enquiry type to a known one.
 * Unknown/blank values fall back to the default rather than throwing, so a
 * stale bookmark like /contact?type=refund still renders a usable form.
 */
export function normalizeContactType(value) {
  const v = String(value || "").trim().toLowerCase();
  return isContactType(v) ? v : DEFAULT_CONTACT_TYPE;
}

/** Inbox key (INBOX.HELLO | INBOX.ADMIN) an enquiry type routes to. */
export function inboxForType(value) {
  return CONTACT_TYPE_BY_VALUE[normalizeContactType(value)].inbox;
}

/** Destination email address for an enquiry type. */
export function emailForType(value) {
  return INBOX_EMAIL[inboxForType(value)];
}

/** Human label for the enquiry type, e.g. "Billing question". */
export function labelForType(value) {
  return CONTACT_TYPE_BY_VALUE[normalizeContactType(value)].label;
}

/**
 * Subject line for an outgoing enquiry.
 * Shape: "[ADMIN] Legal & terms — <user subject>", so the receiving mailbox can
 * filter on the tag and a human can read the rest.
 */
export function buildSubject(type, userSubject) {
  const t = normalizeContactType(type);
  const trimmed = String(userSubject || "").trim();
  const head = `[${INBOX_TAG[inboxForType(t)]}] ${labelForType(t)}`;
  return trimmed ? `${head} — ${trimmed}` : `${head} — Contact form submission`;
}
