import { describe, it, expect } from "vitest";
import {
  VISIBILITY, SHAREABLE, isIndexable, isGalleryEligible, canTransition,
  resolveSlugForRepublish, previewAccess, VISIBILITY_LABELS, DENIAL_COPY,
} from "./visibilityModel.js";

const report = (over = {}) => ({
  id: "r1", slug: "abc12345", owner_id: "owner", visibility: VISIBILITY.LINK, ...over,
});

describe("indexability — only `public` is indexable", () => {
  it("public is indexable and gallery-eligible", () => {
    expect(isIndexable(VISIBILITY.PUBLIC)).toBe(true);
    expect(isGalleryEligible(VISIBILITY.PUBLIC)).toBe(true);
  });

  it("every other shared state carries noindex", () => {
    // A link/org/named report reaching a search index is a data leak, not a
    // ranking opportunity.
    for (const v of [VISIBILITY.LINK, VISIBILITY.ORG, VISIBILITY.NAMED,
                     VISIBILITY.PRIVATE, VISIBILITY.REVOKED]) {
      expect(isIndexable(v)).toBe(false);
      expect(isGalleryEligible(v)).toBe(false);
    }
  });
});

describe("canTransition", () => {
  it("allows publishing from private into any shareable state", () => {
    for (const to of SHAREABLE) {
      expect(canTransition(VISIBILITY.PRIVATE, to).ok).toBe(true);
    }
  });

  it("allows unpublishing back to private", () => {
    expect(canTransition(VISIBILITY.LINK, VISIBILITY.PRIVATE).ok).toBe(true);
  });

  it("allows revoking from anywhere", () => {
    expect(canTransition(VISIBILITY.PUBLIC, VISIBILITY.REVOKED).ok).toBe(true);
  });

  it("REVOKED IS TERMINAL — nothing leaves it", () => {
    // This is the whole difference between revoke and unpublish. If a revoked
    // report could be re-published, "revoke" would be indistinguishable from
    // "unpublish" to an attacker who already holds the URL.
    for (const to of [...SHAREABLE, VISIBILITY.PRIVATE]) {
      expect(canTransition(VISIBILITY.REVOKED, to)).toEqual({ ok: false, reason: "revoked" });
    }
  });

  it("rejects an unknown target state", () => {
    expect(canTransition(VISIBILITY.PRIVATE, "telepathic").ok).toBe(false);
  });
});

describe("resolveSlugForRepublish — decision D3: REUSE", () => {
  it("reuses the slug a report already had, so an already-sent link revives", () => {
    expect(resolveSlugForRepublish(report({ slug: "keepme1" }))).toBe("keepme1");
  });

  it("returns null when the report never had one, so the caller mints", () => {
    expect(resolveSlugForRepublish(report({ slug: null }))).toBeNull();
    expect(resolveSlugForRepublish(null)).toBeNull();
  });
});

describe("previewAccess — mirrors resolve_report_access()", () => {
  it("a link report opens for anyone", () => {
    expect(previewAccess(report(), {}).ok).toBe(true);
  });

  it("a private report denies a stranger but not its owner", () => {
    const r = report({ visibility: VISIBILITY.PRIVATE });
    expect(previewAccess(r, { userId: "someone" })).toEqual({ ok: false, reason: "private" });
    expect(previewAccess(r, { userId: "owner" })).toEqual({ ok: true, reason: "owner" });
  });

  it("a revoked report denies EVERYONE, its owner included", () => {
    const r = report({ visibility: VISIBILITY.REVOKED });
    expect(previewAccess(r, { userId: "owner" })).toEqual({ ok: false, reason: "revoked" });
  });

  it("an expired link denies a viewer but still opens for the owner to re-publish", () => {
    const r = report({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(previewAccess(r, {}).reason).toBe("expired");
    expect(previewAccess(r, { userId: "owner" }).ok).toBe(true);
  });

  it("a not-yet-expired link still opens", () => {
    const r = report({ expires_at: new Date(Date.now() + 60_000).toISOString() });
    expect(previewAccess(r, {}).ok).toBe(true);
  });

  it("an org report follows workspace membership", () => {
    const r = report({ visibility: VISIBILITY.ORG, workspace_id: "ws1" });
    expect(previewAccess(r, { userId: "u2", workspaceIds: ["ws1"] }).ok).toBe(true);
    expect(previewAccess(r, { userId: "u3", workspaceIds: ["ws9"] }))
      .toEqual({ ok: false, reason: "not_in_workspace" });
    expect(previewAccess(r, { userId: "u4" }).ok).toBe(false);
  });

  it("a named report is email-bound and case-insensitive", () => {
    const r = report({ visibility: VISIBILITY.NAMED, grants: [{ email: "Mate@X.com" }] });
    expect(previewAccess(r, { userId: "u2", email: "mate@x.com" }).ok).toBe(true);
    expect(previewAccess(r, { userId: "u3", email: "other@x.com" }))
      .toEqual({ ok: false, reason: "not_granted" });
  });

  it("a revoked grant no longer opens the report", () => {
    const r = report({ visibility: VISIBILITY.NAMED,
      grants: [{ email: "mate@x.com", revoked_at: new Date().toISOString() }] });
    expect(previewAccess(r, { email: "mate@x.com" }).ok).toBe(false);
  });

  it("reports not_found for a missing report rather than throwing", () => {
    expect(previewAccess(null, {})).toEqual({ ok: false, reason: "not_found" });
  });

  it("every denial reason has user-facing copy", () => {
    for (const reason of ["not_found", "private", "revoked", "expired",
                          "not_in_workspace", "not_granted", "unknown_visibility"]) {
      expect(DENIAL_COPY[reason]).toBeTruthy();
    }
  });

  it("every visibility state has a label and a hint for the share dialog", () => {
    for (const v of Object.values(VISIBILITY)) {
      expect(VISIBILITY_LABELS[v]?.label).toBeTruthy();
      expect(VISIBILITY_LABELS[v]?.hint).toBeTruthy();
    }
  });
});
