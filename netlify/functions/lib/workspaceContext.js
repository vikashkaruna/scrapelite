// workspaceContext.js — resolves whether a request acting "as" a workspace
// belongs to a member whose seat is currently paused.
//
// Why this exists: entitlementModel.js's can() has always had a
// `ctx.memberPaused` branch (unit-tested in isolation since the Team
// Workspaces session), and workspaces.js has let an owner/admin pause a
// member's seat since the same session — but nothing between those two ever
// ran. extract.js / ai.js / discoverability.js had no notion of "which
// workspace is this request against" at all, so `ctx.memberPaused` was never
// set to anything but its default `false`. A UI toggle that looks enforced
// but isn't is worse than no toggle, so this module is the missing link:
// given a workspace id a caller SAYS they are acting under, and the caller's
// own user id (already resolved from their JWT — never trust a client-
// supplied user id), look up their real membership row and report whether
// their seat is paused.
//
// Scope, stated plainly: this closes the ENFORCEMENT gap, not the bigger
// "save every extraction/audit under a workspace" feature the docs describe
// as its own deferred project (a global WorkspaceContext + TopBar switcher +
// threading every save path). A request that names a workspace_id is now
// correctly refused or allowed; a request that names none behaves exactly as
// it always has (personal, ungated by workspace state).
import { getServiceDb } from "./requireEntitlement.js";
import {
  defaultDiscoverabilityRole, requireDiscoverabilityRole,
} from "../../../src/lib/discoverability/governanceModel.js";

/**
 * @param {string} workspaceId - client-supplied; untrusted until matched
 *   against a real workspace_members row for this user.
 * @param {string} userId - the CALLER's own id, resolved server-side from
 *   their JWT (resolveRequestEntitlement's `userId`). Never accept this as a
 *   request parameter — that would let anyone check anyone else's pause state
 *   or, worse, act on their behalf.
 * @returns {Promise<
 *   {ok:true, memberPaused:boolean} |
 *   {ok:false, code:string, message:string}
 * >}
 *   ok:false means "refuse the request" — the caller named a workspace they
 *   are not a member of. ok:true with memberPaused:false covers both "not
 *   paused" and "the lookup degraded" — same fail-open posture as
 *   fetchEntitlement's `degraded` flag in requireEntitlement.js: an
 *   unreachable service key must never turn into a full outage, only a
 *   skipped check. Called only when workspaceId is truthy; a personal
 *   (non-workspace) request never reaches this module at all.
 */
export async function resolveWorkspaceMembership(workspaceId, userId) {
  const db = getServiceDb();
  if (!db) return { ok: true, memberPaused: false };
  try {
    const res = await fetch(
      `${db.base}/workspace_members` +
        `?workspace_id=eq.${encodeURIComponent(workspaceId)}` +
        `&user_id=eq.${encodeURIComponent(userId)}` +
        `&select=paused_at,role,discoverability_role&limit=1`,
      { headers: db.headers },
    );
    if (!res.ok) return { ok: true, memberPaused: false };
    const rows = await res.json();
    const row = Array.isArray(rows) && rows[0];
    if (!row) {
      return {
        ok: false,
        code: "WORKSPACE_NOT_MEMBER",
        message: "You are not a member of this workspace.",
      };
    }
    const result = {
      ok: true,
      memberPaused: Boolean(row.paused_at),
    };
    const discoverabilityRole = row.discoverability_role
      || (row.role ? defaultDiscoverabilityRole(row.role) : null);
    if (discoverabilityRole) {
      result.discoverabilityRole = discoverabilityRole;
    }
    return result;
  } catch {
    return { ok: true, memberPaused: false };
  }
}

/**
 * Convenience wrapper for the common call shape: given an already-resolved
 * entitlement (`resolved.userId`) and a raw, possibly-absent workspace id
 * from the request body, produce either a `ctx` object ready to hand to
 * `checkCapability(resolved, capability, ctx)`, or a refusal to render as a
 * 403 immediately.
 *
 * @param {{userId:string|null}} resolved
 * @param {unknown} rawWorkspaceId
 */
export async function buildWorkspaceCtx(resolved, rawWorkspaceId) {
  const workspaceId = typeof rawWorkspaceId === "string" ? rawWorkspaceId.trim() : "";
  if (!workspaceId || !resolved?.userId) return { ctx: {}, refusal: null };
  const membership = await resolveWorkspaceMembership(workspaceId, resolved.userId);
  if (!membership.ok) {
    return { ctx: null, refusal: { code: membership.code, message: membership.message } };
  }
  const ctx = {
    memberPaused: membership.memberPaused,
  };
  if (membership.discoverabilityRole) {
    ctx.discoverabilityRole = membership.discoverabilityRole;
  }
  return {
    ctx,
    refusal: null,
  };
}

/** Apply a Discoverability-scoped action after membership is established. */
export async function requireWorkspaceDiscoverabilityAction(userId, rawWorkspaceId, action) {
  const workspaceId = typeof rawWorkspaceId === "string" ? rawWorkspaceId.trim() : "";
  if (!workspaceId) return { ok: true, ctx: {}, personal: true };
  const built = await buildWorkspaceCtx({ userId }, workspaceId);
  if (built.refusal) return { ok: false, refusal: built.refusal };
  if (built.ctx.workspaceMembershipDegraded || !built.ctx.discoverabilityRole) {
    return { ok: true, ctx: built.ctx, degraded: true };
  }
  const permission = requireDiscoverabilityRole(built.ctx.discoverabilityRole, action);
  if (!permission.ok) {
    return {
      ok: false,
      refusal: {
        code: permission.code,
        message: `Your Discoverability role cannot ${action.replaceAll("_", " ")} in this workspace.`,
      },
    };
  }
  return { ok: true, ctx: built.ctx, degraded: false };
}
