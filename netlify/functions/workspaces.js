// netlify/functions/workspaces.js — real multi-user workspaces.
//
//   GET  /api/workspaces                    → my workspaces + can-create-another
//   GET  /api/workspaces?workspaceId=<id>   → that workspace's members + pending invites
//                                              (only if the caller is a member)
//   POST /api/workspaces { action, ... }    → create | invite | accept | remove | revoke_invite
//
// Signed-in only, every action — same reasoning as referral.js and
// scrape-consent.js: a workspace membership is a real, billable seat, not
// something an anonymous cookie should be able to hold or grant.
//
// Entitlement checks (workspace.create, workspace.team_seats) run HERE, in the
// handler, using entitlementModel.can() against the caller's OWN plan — the
// SQL functions in 0031_team_workspaces.sql do not know about plans at all
// (see that migration's header comment on why the split is JS-decides /
// SQL-enforces-integrity, matching create-checkout.js's coupon pattern).

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import {
  resolveRequestEntitlement,
  checkCapability,
  denyResponse,
} from "./lib/requireEntitlement.js";
import {
  listMyWorkspaces,
  countOwnedWorkspaces,
  countWorkspaceSeats,
  createWorkspace,
  inviteToWorkspace,
  acceptWorkspaceInvite,
  removeWorkspaceMember,
  setWorkspaceMemberPaused,
  setWorkspaceDiscoverabilityRole,
  listWorkspaceMembers,
  listPendingInvites,
  revokeInvite,
  myRole,
  serviceDb,
} from "./lib/workspaces.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const REASON_COPY = {
  not_authorized: "You don't have permission to do that in this workspace.",
  already_member: "That person is already in this workspace.",
  already_invited: "There's already a pending invite for that address.",
  invalid: "That request wasn't valid. Check the details and try again.",
  revoked: "That invite has been revoked.",
  expired: "That invite has expired. Ask for a new one.",
  already_accepted: "That invite has already been used.",
  email_mismatch: "That invite was sent to a different email address than your account's.",
  owner_cannot_leave: "The workspace owner can't leave. Transfer ownership or delete the workspace instead.",
  cannot_remove_owner: "The workspace owner can't be removed.",
  // An owner who could be paused could pause themselves and then be unable to
  // unpause themselves — the workspace would need support to recover. Same
  // reasoning as owner_cannot_leave above.
  cannot_pause_owner: "The workspace owner can't be paused.",
  not_found: "That person isn't a member of this workspace.",
  invalid_role: "Choose a valid Discoverability role.",
  unavailable: "Workspaces are temporarily unavailable. Please try again shortly.",
};

function respond(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", ...CORS }, body: JSON.stringify(body) };
}

function refusal(reason, status = 409) {
  return respond(status, { ok: false, reason, error: REASON_COPY[reason] || REASON_COPY.invalid });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const auth = await authenticateBearer(event, { label: "workspaces" });
  if (!auth.ok) return respond(auth.status || 401, auth.body || { error: "Authentication required" });
  const userId = auth.user.id;
  const userEmail = auth.user.email || "";

  if (event.httpMethod === "GET") {
    const workspaceId = event.queryStringParameters?.workspaceId;

    if (workspaceId) {
      const db = serviceDb();
      const role = db ? await myRole(db, workspaceId, userId) : null;
      if (!role) return respond(403, { error: "You are not a member of that workspace." });

      const [{ members, degraded: d1 }, { invites, degraded: d2 }] = await Promise.all([
        listWorkspaceMembers(workspaceId),
        listPendingInvites(workspaceId),
      ]);
      return respond(200, {
        ok: true,
        myRole: role,
        members,
        // Only owner/admin need the pending-invite list; a plain member
        // gets an empty array rather than being told who else was invited.
        invites: role === "owner" || role === "admin" ? invites : [],
        degraded: d1 || d2,
      });
    }

    const [{ workspaces, degraded: d1 }, { count: owned, degraded: d2 }] = await Promise.all([
      listMyWorkspaces(userId),
      countOwnedWorkspaces(userId),
    ]);
    const resolved = await resolveRequestEntitlement(event);
    const createCheck = checkCapability(resolved, "workspace.create", { workspacesOwned: owned });

    return respond(200, {
      ok: true,
      workspaces,
      canCreate: { allowed: createCheck.allowed, remaining: createCheck.remaining },
      degraded: d1 || d2,
    });
  }

  if (event.httpMethod === "POST") {
    let body = {};
    try { body = event.body ? JSON.parse(event.body) : {}; }
    catch { return respond(400, { error: "Invalid JSON body" }); }

    const action = body.action;

    if (action === "create") {
      const { count: owned } = await countOwnedWorkspaces(userId);
      const resolved = await resolveRequestEntitlement(event);
      const check = checkCapability(resolved, "workspace.create", { workspacesOwned: owned });
      if (!check.allowed) return denyResponse(check, CORS);

      const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
      const result = await createWorkspace(userId, name);
      if (!result.ok) return refusal("unavailable", 503);
      return respond(200, { ok: true, workspaceId: result.workspaceId });
    }

    if (action === "invite") {
      const { workspaceId, email, role } = body;
      const inviteEmail = typeof email === "string" ? email.trim() : "";
      if (!workspaceId || !inviteEmail) return respond(400, { error: "workspaceId and email are required" });

      const { count: seatsUsed } = await countWorkspaceSeats(workspaceId);
      const resolved = await resolveRequestEntitlement(event);
      const check = checkCapability(resolved, "workspace.team_seats", { seatsUsed });
      if (!check.allowed) return denyResponse(check, CORS);

      const result = await inviteToWorkspace(workspaceId, userId, inviteEmail, role);
      if (!result.ok) {
        return refusal(result.reason, result.reason === "unavailable" ? 503 : 409);
      }
      return respond(200, { ok: true, token: result.token, expiresAt: result.expiresAt });
    }

    if (action === "accept") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!token) return respond(400, { error: "token is required" });
      const result = await acceptWorkspaceInvite(token, userId, userEmail);
      if (!result.ok) return refusal(result.reason, result.reason === "unavailable" ? 503 : 409);
      return respond(200, { ok: true, workspaceId: result.workspaceId });
    }

    if (action === "remove") {
      const { workspaceId, targetUserId } = body;
      if (!workspaceId || !targetUserId) return respond(400, { error: "workspaceId and targetUserId are required" });
      const result = await removeWorkspaceMember(workspaceId, userId, targetUserId);
      if (!result.ok) return refusal(result.reason, result.reason === "unavailable" ? 503 : 409);
      return respond(200, { ok: true });
    }

    if (action === "set_member_paused") {
      // Pausing a seat stops everything that consumes account units for that
      // person while leaving read and export intact — the workspace-scoped
      // sibling of an account freeze. It is NOT a removal: the seat is still
      // theirs and still counts against team_seats.
      //
      // Every rule is enforced in SQL (0032), not here, so a second caller
      // cannot get a different answer: the owner is unpausable by anybody
      // including themselves, and an admin cannot pause a peer.
      const { workspaceId, targetUserId, paused } = body;
      if (!workspaceId || !targetUserId) {
        return respond(400, { error: "workspaceId and targetUserId are required" });
      }
      const result = await setWorkspaceMemberPaused(workspaceId, userId, targetUserId, paused);
      if (!result.ok) return refusal(result.reason, result.reason === "unavailable" ? 503 : 409);
      return respond(200, { ok: true, paused: Boolean(paused) });
    }

    if (action === "set_discoverability_role") {
      const { workspaceId, targetUserId, role } = body;
      if (!workspaceId || !targetUserId || !role) {
        return respond(400, { error: "workspaceId, targetUserId and role are required" });
      }
      const result = await setWorkspaceDiscoverabilityRole(
        workspaceId, userId, targetUserId, role,
      );
      if (!result.ok) {
        const status = result.reason === "not_authorized" ? 403
          : result.reason === "unavailable" ? 503 : 409;
        return refusal(result.reason, status);
      }
      return respond(200, { ok: true, role });
    }

    if (action === "revoke_invite") {
      const { workspaceId, inviteId } = body;
      if (!workspaceId || !inviteId) return respond(400, { error: "workspaceId and inviteId are required" });
      const db = serviceDb();
      const role = db ? await myRole(db, workspaceId, userId) : null;
      if (role !== "owner" && role !== "admin") return refusal("not_authorized", 403);
      const result = await revokeInvite(inviteId, workspaceId);
      if (!result.ok) return refusal("unavailable", 503);
      return respond(200, { ok: true });
    }

    return respond(400, { error: `Unknown action: ${action}` });
  }

  return respond(405, { error: "Method not allowed" });
};
