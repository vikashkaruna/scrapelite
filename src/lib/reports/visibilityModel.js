// src/lib/reports/visibilityModel.js — the report access state machine.
//
// PURE. The server-side authority is resolve_report_access() in
// 0039_report_access.sql; this module is the SAME rules expressed for the
// client, so the UI can grey out an impossible transition instead of offering
// it and having the server refuse. Where the two could disagree, the database
// wins — this is a UX mirror, never an authorization decision.
//
// ── DECISION D3, RESOLVED 2026-09-02 ────────────────────────────────────────
// Private by default, with an explicit publish. `unpublish` and `revoke` are
// SEPARATE verbs, and re-publishing REUSES the original slug.
//
// Why separate verbs: collapsing them forces the user to choose between
// convenience and safety on every click — so they pick convenience and stop
// using the safe one. "Hide this for the afternoon" and "this leaked, burn it"
// are different intentions and must not share a button.
//
// Why REUSE on re-publish: unpublish is the reversible control. A colleague
// who already has the link expects it to work again when you un-hide the
// report. Minting a fresh slug there would silently break every link already
// sent, for a security benefit that revoke() already provides deliberately.

export const VISIBILITY = Object.freeze({
  PRIVATE: "private",
  LINK: "link",
  ORG: "org",
  NAMED: "named",
  PUBLIC: "public",
  REVOKED: "revoked",
});

/** States a user may actively publish into. */
export const SHAREABLE = Object.freeze([
  VISIBILITY.LINK, VISIBILITY.ORG, VISIBILITY.NAMED, VISIBILITY.PUBLIC,
]);

/** Only `public` is indexable. Everything else carries noindex. */
export function isIndexable(visibility) {
  return visibility === VISIBILITY.PUBLIC;
}

/** Only `public` is eligible for /gallery (subject to admin curation). */
export function isGalleryEligible(visibility) {
  return visibility === VISIBILITY.PUBLIC;
}

export const VISIBILITY_LABELS = Object.freeze({
  private: { label: "Private", hint: "Only you. No link exists yet." },
  link:    { label: "Anyone with the link", hint: "Unlisted and not indexed by search engines." },
  org:     { label: "Workspace only", hint: "Any member of this workspace can open it." },
  named:   { label: "Specific people", hint: "Only the email addresses you list." },
  public:  { label: "Public", hint: "Listed, indexable, and eligible for the public gallery." },
  revoked: { label: "Revoked", hint: "This link was permanently burned and cannot be restored." },
});

/**
 * Can `from` move to `to`?
 * Returns { ok, reason } — `reason` is shown in the UI when a control is disabled.
 */
export function canTransition(from, to) {
  if (from === VISIBILITY.REVOKED) {
    return { ok: false, reason: "revoked" };
  }
  if (to === VISIBILITY.REVOKED) return { ok: true };
  if (to === VISIBILITY.PRIVATE) return { ok: true };
  if (!SHAREABLE.includes(to)) return { ok: false, reason: "invalid_visibility" };
  return { ok: true };
}

/**
 * D3, expressed as code. Called when a previously-shared report is published
 * again: reuse the slug it already had, mint only if it never had one.
 *
 * `revoke()` is the terminal path and always burns the slug — this function is
 * never consulted there, which is what keeps the two verbs meaningfully
 * different.
 */
export function resolveSlugForRepublish(report) {
  return report?.slug || null; // null → the caller mints a fresh one
}

/**
 * Would a viewer be able to open this report? Mirrors resolve_report_access().
 * The server decides for real; this exists so the owner's own share dialog can
 * say "Sam cannot open this yet" without a round trip.
 */
export function previewAccess(report, viewer = {}, now = Date.now()) {
  if (!report) return { ok: false, reason: "not_found" };
  const { visibility } = report;

  if (visibility === VISIBILITY.REVOKED) return { ok: false, reason: "revoked" };

  const isOwner = !!viewer.userId && report.owner_id === viewer.userId;
  if (visibility === VISIBILITY.PRIVATE) {
    return isOwner ? { ok: true, reason: "owner" } : { ok: false, reason: "private" };
  }
  if (report.expires_at && new Date(report.expires_at).getTime() <= now) {
    return isOwner ? { ok: true, reason: "owner" } : { ok: false, reason: "expired" };
  }
  if (visibility === VISIBILITY.PUBLIC || visibility === VISIBILITY.LINK) {
    return { ok: true, reason: visibility };
  }
  if (visibility === VISIBILITY.ORG) {
    if (isOwner) return { ok: true, reason: "owner" };
    return viewer.workspaceIds?.includes(report.workspace_id)
      ? { ok: true, reason: "org" }
      : { ok: false, reason: "not_in_workspace" };
  }
  if (visibility === VISIBILITY.NAMED) {
    if (isOwner) return { ok: true, reason: "owner" };
    const email = String(viewer.email || "").toLowerCase();
    const granted = (report.grants || [])
      .filter((g) => !g.revoked_at)
      .map((g) => String(g.email || "").toLowerCase());
    return email && granted.includes(email)
      ? { ok: true, reason: "named" }
      : { ok: false, reason: "not_granted" };
  }
  return { ok: false, reason: "unknown_visibility" };
}

/** Copy for the "why can't they see this" line in the share dialog. */
export const DENIAL_COPY = Object.freeze({
  not_found: "This report no longer exists.",
  private: "This report is private. Publish it to share.",
  revoked: "This link was revoked and cannot be restored. Create a new report to share again.",
  expired: "This link has expired. Publish it again to restore access.",
  not_in_workspace: "Only members of this workspace can open it.",
  not_granted: "This address has not been given access.",
  unknown_visibility: "This report's sharing settings could not be read.",
});
