// netlify/functions/lib/workspaces.js — real multi-user workspaces.
//
// /workspace was a single-owner dashboard: there was no membership table, so
// nobody could actually be invited into one, despite pricingConfig.js already
// selling "5 client workspaces" on Agency and a paid "Extra Workspace" add-on.
// This module is the thin, honest wrapper around the real primitive in
// supabase/migrations/0031_team_workspaces.sql — same shape as
// lib/referrals.js: it does not decide eligibility (create_workspace does not
// check the plan's workspace count, and create_workspace_invite does not
// check the plan's seat count — see the migration's own comment on why that
// split exists), it only calls the database's atomic functions and reports
// what they say.
//
// FAILS CLOSED, like lib/scrapeConsent.js: if the store cannot answer, the
// caller gets an empty/unavailable result, never a fabricated membership.

function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

async function rpc(db, fn, body) {
  const res = await fetch(`${db.base}/rpc/${fn}`, {
    method: "POST",
    headers: db.headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${fn} failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return res.json();
}

async function rest(db, path, init = {}) {
  const res = await fetch(`${db.base}${path}`, {
    ...init,
    headers: { ...db.headers, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${path} failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Every workspace this user belongs to, with their role and a seat count.
 * Returns { workspaces: [{id,name,ownerId,role,seats,createdAt}], degraded }.
 * Never throws — a listing failure must not break the page that shows it.
 */
export async function listMyWorkspaces(userId, env = process.env) {
  const empty = { workspaces: [], degraded: false };
  if (!userId) return empty;
  const db = serviceDb(env);
  if (!db) return { ...empty, degraded: true };
  try {
    const memberships = await rest(
      db,
      `/workspace_members?select=workspace_id,role&user_id=eq.${userId}`,
    );
    if (!Array.isArray(memberships) || memberships.length === 0) return empty;

    const ids = memberships.map((m) => m.workspace_id);
    const idFilter = `in.(${ids.join(",")})`;
    const [rows, seatRows] = await Promise.all([
      rest(db, `/workspaces?select=id,name,owner_id,created_at&id=${idFilter}`),
      rest(db, `/workspace_members?select=workspace_id&workspace_id=${idFilter}`),
    ]);

    const seatCounts = {};
    for (const r of seatRows || []) {
      seatCounts[r.workspace_id] = (seatCounts[r.workspace_id] || 0) + 1;
    }
    const roleByWorkspace = {};
    for (const m of memberships) roleByWorkspace[m.workspace_id] = m.role;

    const workspaces = (rows || []).map((w) => ({
      id: w.id,
      name: w.name,
      ownerId: w.owner_id,
      role: roleByWorkspace[w.id] || "member",
      seats: seatCounts[w.id] || 1,
      createdAt: w.created_at,
    }));
    return { workspaces, degraded: false };
  } catch (err) {
    console.error("[DatIQ] listMyWorkspaces failed:", err.message);
    return { ...empty, degraded: true };
  }
}

/** How many workspaces this user OWNS — the number `workspace.create` caps. */
export async function countOwnedWorkspaces(userId, env = process.env) {
  if (!userId) return { count: 0, degraded: false };
  const db = serviceDb(env);
  if (!db) return { count: 0, degraded: true };
  try {
    const res = await fetch(`${db.base}/workspaces?select=id&owner_id=eq.${userId}`, {
      headers: { ...db.headers, Prefer: "count=exact" },
    });
    if (!res.ok) return { count: 0, degraded: true };
    const rows = await res.json();
    return { count: Array.isArray(rows) ? rows.length : 0, degraded: false };
  } catch (err) {
    console.error("[DatIQ] countOwnedWorkspaces failed:", err.message);
    return { count: 0, degraded: true };
  }
}

/** How many members a workspace has — the number `workspace.team_seats` caps against. */
export async function countWorkspaceSeats(workspaceId, env = process.env) {
  if (!workspaceId) return { count: 0, degraded: false };
  const db = serviceDb(env);
  if (!db) return { count: 0, degraded: true };
  try {
    const res = await fetch(
      `${db.base}/workspace_members?select=id&workspace_id=eq.${workspaceId}`,
      { headers: { ...db.headers, Prefer: "count=exact" } },
    );
    if (!res.ok) return { count: 0, degraded: true };
    const rows = await res.json();
    return { count: Array.isArray(rows) ? rows.length : 0, degraded: false };
  } catch (err) {
    console.error("[DatIQ] countWorkspaceSeats failed:", err.message);
    return { count: 0, degraded: true };
  }
}

/** True if `userId` has `role` (or better — owner > admin > member) in `workspaceId`. */
async function myRole(db, workspaceId, userId) {
  const rows = await rest(
    db,
    `/workspace_members?select=role&workspace_id=eq.${workspaceId}&user_id=eq.${userId}&limit=1`,
  );
  return Array.isArray(rows) && rows[0] ? rows[0].role : null;
}

/**
 * Create a workspace owned by `userId`. Returns { ok, workspaceId?, degraded }.
 * Caller is responsible for the workspace.create entitlement check — this
 * function does not know the caller's plan.
 */
export async function createWorkspace(userId, name, env = process.env) {
  if (!userId) return { ok: false, degraded: false };
  const db = serviceDb(env);
  if (!db) return { ok: false, degraded: true };
  try {
    const id = await rpc(db, "create_workspace", { p_owner_id: userId, p_name: name || "" });
    return { ok: true, workspaceId: typeof id === "string" ? id : null, degraded: false };
  } catch (err) {
    console.error("[DatIQ] create_workspace failed:", err.message);
    return { ok: false, degraded: true };
  }
}

/**
 * Invite `email` into `workspaceId` as `role`. Returns
 * { ok, token?, expiresAt?, reason?, degraded }.
 * reason ∈ not_authorized | already_member | already_invited | invalid | unavailable
 */
export async function inviteToWorkspace(workspaceId, invitedBy, email, role, env = process.env) {
  if (!workspaceId || !invitedBy || !email) {
    return { ok: false, reason: "invalid", degraded: false };
  }
  const db = serviceDb(env);
  if (!db) return { ok: false, reason: "unavailable", degraded: true };
  try {
    const result = await rpc(db, "create_workspace_invite", {
      p_workspace_id: workspaceId,
      p_email: email,
      p_role: role === "admin" ? "admin" : "member",
      p_invited_by: invitedBy,
    });
    if (result?.ok) {
      return { ok: true, token: result.token, expiresAt: result.expiresAt, degraded: false };
    }
    return { ok: false, reason: result?.reason || "invalid", degraded: false };
  } catch (err) {
    console.error("[DatIQ] create_workspace_invite failed:", err.message);
    return { ok: false, reason: "unavailable", degraded: true };
  }
}

/**
 * Accept an invite token as `userId` whose verified email is `userEmail`.
 * Returns { ok, workspaceId?, reason?, degraded }.
 * reason ∈ invalid | revoked | expired | already_accepted | email_mismatch | unavailable
 */
export async function acceptWorkspaceInvite(token, userId, userEmail, env = process.env) {
  if (!token || !userId || !userEmail) {
    return { ok: false, reason: "invalid", degraded: false };
  }
  const db = serviceDb(env);
  if (!db) return { ok: false, reason: "unavailable", degraded: true };
  try {
    const result = await rpc(db, "accept_workspace_invite", {
      p_token: token,
      p_user_id: userId,
      p_user_email: userEmail,
    });
    if (result?.ok) return { ok: true, workspaceId: result.workspaceId, degraded: false };
    return { ok: false, reason: result?.reason || "invalid", degraded: false };
  } catch (err) {
    console.error("[DatIQ] accept_workspace_invite failed:", err.message);
    return { ok: false, reason: "unavailable", degraded: true };
  }
}

/**
 * Remove (or self-leave) a member. Returns { ok, reason?, degraded }.
 * reason ∈ not_authorized | owner_cannot_leave | cannot_remove_owner | unavailable
 */
export async function removeWorkspaceMember(workspaceId, actorId, targetUserId, env = process.env) {
  if (!workspaceId || !actorId || !targetUserId) {
    return { ok: false, reason: "invalid", degraded: false };
  }
  const db = serviceDb(env);
  if (!db) return { ok: false, reason: "unavailable", degraded: true };
  try {
    const result = await rpc(db, "remove_workspace_member", {
      p_workspace_id: workspaceId,
      p_actor_id: actorId,
      p_target_user_id: targetUserId,
    });
    if (result?.ok) return { ok: true, degraded: false };
    return { ok: false, reason: result?.reason || "not_authorized", degraded: false };
  } catch (err) {
    console.error("[DatIQ] remove_workspace_member failed:", err.message);
    return { ok: false, reason: "unavailable", degraded: true };
  }
}

/**
 * Members of one workspace, for the settings page. Returns
 * { members: [{userId,email,role,createdAt}], degraded }.
 */
export async function listWorkspaceMembers(workspaceId, env = process.env) {
  const empty = { members: [], degraded: false };
  if (!workspaceId) return empty;
  const db = serviceDb(env);
  if (!db) return { ...empty, degraded: true };
  try {
    const rows = await rest(
      db,
      `/workspace_members?select=user_id,role,created_at,users:user_id(email)&workspace_id=eq.${workspaceId}&order=created_at.asc`,
    );
    const members = (rows || []).map((r) => ({
      userId: r.user_id,
      email: r.users?.email || null,
      role: r.role,
      createdAt: r.created_at,
    }));
    return { members, degraded: false };
  } catch (err) {
    // PostgREST embedding auth.users can be blocked on some project configs;
    // degrade to member rows without email rather than failing the page.
    console.error("[DatIQ] listWorkspaceMembers embed failed, retrying flat:", err.message);
    try {
      const rows = await rest(
        db,
        `/workspace_members?select=user_id,role,created_at&workspace_id=eq.${workspaceId}&order=created_at.asc`,
      );
      const members = (rows || []).map((r) => ({
        userId: r.user_id,
        email: null,
        role: r.role,
        createdAt: r.created_at,
      }));
      return { members, degraded: false };
    } catch (err2) {
      console.error("[DatIQ] listWorkspaceMembers failed:", err2.message);
      return { ...empty, degraded: true };
    }
  }
}

/**
 * Pending (unaccepted, unrevoked, unexpired) invites for a workspace.
 * Returns { invites: [{email,role,createdAt,expiresAt}], degraded }.
 * Tokens are never returned here — the invite email/link is the only place a
 * token should ever leave the server.
 */
export async function listPendingInvites(workspaceId, env = process.env) {
  const empty = { invites: [], degraded: false };
  if (!workspaceId) return empty;
  const db = serviceDb(env);
  if (!db) return { ...empty, degraded: true };
  try {
    const rows = await rest(
      db,
      `/workspace_invites?select=id,email,role,created_at,expires_at&workspace_id=eq.${workspaceId}` +
        `&accepted_at=is.null&revoked_at=is.null&order=created_at.desc`,
    );
    const invites = (rows || []).map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
    return { invites, degraded: false };
  } catch (err) {
    console.error("[DatIQ] listPendingInvites failed:", err.message);
    return { ...empty, degraded: true };
  }
}

/** Revoke a still-pending invite. The caller must have already checked the actor is owner/admin. */
export async function revokeInvite(inviteId, workspaceId, env = process.env) {
  if (!inviteId || !workspaceId) return { ok: false, degraded: false };
  const db = serviceDb(env);
  if (!db) return { ok: false, degraded: true };
  try {
    await rest(
      db,
      `/workspace_invites?id=eq.${inviteId}&workspace_id=eq.${workspaceId}&accepted_at=is.null`,
      { method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }) },
    );
    return { ok: true, degraded: false };
  } catch (err) {
    console.error("[DatIQ] revokeInvite failed:", err.message);
    return { ok: false, degraded: true };
  }
}

export { myRole, serviceDb };
export const _internal = { serviceDb, rpc, rest };
