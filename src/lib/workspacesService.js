// src/lib/workspacesService.js — team workspaces, client half.
//
// /workspace used to be a single-owner dashboard with no membership concept
// at all, despite pricingConfig.js already selling "5 client workspaces" on
// Agency and a paid "Extra Workspace" add-on. The real primitive lives in
// supabase/migrations/0031_team_workspaces.sql, reached through
// netlify/functions/workspaces.js. This module fetches and reports; it never
// decides eligibility (the server's entitlementModel.can() calls do that) and
// never mints an id or a token.
//
// Every function here NEVER throws — the same contract as referralService.js
// — so a caller can render a refusal without wrapping every call in try/catch.

import { apiClient } from "./apiClient.js";

const UNAVAILABLE = "Workspaces are temporarily unavailable. Please try again shortly.";

/**
 * This user's workspaces, plus whether their plan allows creating another.
 * Returns { workspaces: [], canCreate: {allowed,remaining}, degraded, error? }.
 */
export async function fetchMyWorkspaces() {
  try {
    const res = await apiClient.listWorkspaces();
    return {
      workspaces: Array.isArray(res?.workspaces) ? res.workspaces : [],
      canCreate: res?.canCreate ?? { allowed: false, remaining: 0 },
      degraded: res?.degraded === true,
    };
  } catch (err) {
    return {
      workspaces: [],
      canCreate: { allowed: false, remaining: 0 },
      degraded: true,
      error: err?.message || UNAVAILABLE,
    };
  }
}

/**
 * One workspace's members and (owner/admin only) pending invites.
 * Returns { myRole, members: [], invites: [], degraded, error? } — myRole is
 * null and members/invites are empty when the caller isn't a member (403) or
 * the workspace doesn't exist (404), so the UI can render "not found" either way.
 */
export async function fetchWorkspace(workspaceId) {
  const empty = { myRole: null, members: [], invites: [], degraded: false };
  if (!workspaceId) return empty;
  try {
    const res = await apiClient.getWorkspace(workspaceId);
    return {
      myRole: res?.myRole || null,
      members: Array.isArray(res?.members) ? res.members : [],
      invites: Array.isArray(res?.invites) ? res.invites : [],
      degraded: res?.degraded === true,
    };
  } catch (err) {
    return { ...empty, error: err?.message || UNAVAILABLE };
  }
}

/**
 * Create a workspace. Returns { ok, workspaceId?, reason?, error? }.
 * A denial (plan cap reached) arrives via err.code === "QUOTA_EXCEEDED" and
 * err.upgradeTo — the same shape every other entitlement denial in this app
 * already uses, so the paywall copy helpers can handle it identically.
 */
export async function createWorkspace(name) {
  try {
    const res = await apiClient.createWorkspace(name);
    return { ok: true, workspaceId: res?.workspaceId || null };
  } catch (err) {
    return {
      ok: false,
      reason: err?.reason || null,
      code: err?.code || null,
      upgradeTo: err?.upgradeTo ?? null,
      error: err?.message || "Couldn't create that workspace. Please try again.",
    };
  }
}

/**
 * Invite `email` into `workspaceId`. Returns { ok, reason?, error? }.
 * reason ∈ not_authorized | already_member | already_invited | unavailable,
 * or a QUOTA_EXCEEDED entitlement denial (err.code) when the seat cap is hit.
 */
export async function inviteToWorkspace(workspaceId, email, role = "member") {
  const clean = typeof email === "string" ? email.trim() : "";
  if (!workspaceId || !clean) {
    return { ok: false, reason: "invalid", error: "Enter an email address to invite." };
  }
  try {
    await apiClient.inviteToWorkspace(workspaceId, clean, role);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err?.reason || null,
      code: err?.code || null,
      upgradeTo: err?.upgradeTo ?? null,
      error: err?.message || "Couldn't send that invite. Please try again.",
    };
  }
}

/**
 * Accept an invite token for the signed-in user.
 * Returns { ok, workspaceId?, reason?, error? }.
 * reason ∈ invalid | revoked | expired | already_accepted | email_mismatch
 */
export async function acceptWorkspaceInvite(token) {
  const clean = typeof token === "string" ? token.trim() : "";
  if (!clean) return { ok: false, reason: "invalid", error: "That invite link looks incomplete." };
  try {
    const res = await apiClient.acceptWorkspaceInvite(clean);
    return { ok: true, workspaceId: res?.workspaceId || null };
  } catch (err) {
    return {
      ok: false,
      reason: err?.reason || null,
      error: err?.message || "Couldn't accept that invite. Please try again.",
    };
  }
}

/**
 * Remove a member, or leave a workspace (pass your own user id as target).
 * Returns { ok, reason?, error? }.
 * reason ∈ not_authorized | owner_cannot_leave | cannot_remove_owner
 */
export async function removeWorkspaceMember(workspaceId, targetUserId) {
  try {
    await apiClient.removeWorkspaceMember(workspaceId, targetUserId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err?.reason || null,
      error: err?.message || "Couldn't do that. Please try again.",
    };
  }
}

/** Revoke a still-pending invite. Returns { ok, error? }. */
export async function revokeWorkspaceInvite(workspaceId, inviteId) {
  try {
    await apiClient.revokeWorkspaceInvite(workspaceId, inviteId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || UNAVAILABLE };
  }
}
