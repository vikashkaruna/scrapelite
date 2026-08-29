// src/components/workspace/TeamTab.jsx
//
// The Team tab inside /workspace — the first real UI for a primitive that
// used to be sold (pricingConfig.js's "5 client workspaces" on Agency, the
// "Extra Workspace" add-on) but never actually built: /workspace was a
// single-owner dashboard with no membership table behind it at all. This is
// the surface for supabase/migrations/0031_team_workspaces.sql, reached
// through workspacesService.js.
//
// One workspace is selected at a time (?workspace=<id> in the URL, so a
// direct link from an invite email's redirect lands on the right one). A
// user with none yet sees a create form instead of an empty member list.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import Icon from "../Icon.jsx";
import { useAuth } from "../AuthProvider.jsx";
import { useToast } from "../Toast.jsx";
import {
  fetchMyWorkspaces,
  fetchWorkspace,
  createWorkspace,
  inviteToWorkspace,
  removeWorkspaceMember,
  setWorkspaceMemberPaused,
  revokeWorkspaceInvite,
} from "../../lib/workspacesService.js";
import { timeAgo } from "../../lib/utils.js";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" };

function RoleBadge({ role }) {
  return <span className={`ws-role-badge ws-role-${role}`}>{ROLE_LABEL[role] || role}</span>;
}

export default function TeamTab() {
  const { user } = useAuth();
  const showToast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [workspaces, setWorkspaces] = useState([]);
  const [canCreate, setCanCreate] = useState({ allowed: false, remaining: 0 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState({ myRole: null, members: [], invites: [] });
  const [detailLoading, setDetailLoading] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState(null);
  const [lastInviteLink, setLastInviteLink] = useState(null);

  const selectedId = searchParams.get("workspace") || workspaces[0]?.id || null;
  const selected = workspaces.find((w) => w.id === selectedId) || null;

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    const r = await fetchMyWorkspaces();
    setWorkspaces(r.workspaces);
    setCanCreate(r.canCreate);
    setLoading(false);
    if (r.degraded && r.error) showToast(r.error, "alert-triangle");
  }, [showToast]);

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  const loadDetail = useCallback(async (workspaceId) => {
    if (!workspaceId) { setDetail({ myRole: null, members: [], invites: [] }); return; }
    setDetailLoading(true);
    const r = await fetchWorkspace(workspaceId);
    setDetail(r);
    setDetailLoading(false);
  }, []);

  useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);

  const selectWorkspace = (id) => {
    const sp = new URLSearchParams(searchParams);
    sp.set("workspace", id);
    setSearchParams(sp, { replace: true });
  };

  const canManage = detail.myRole === "owner" || detail.myRole === "admin";

  const handleCreate = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    const r = await createWorkspace(name);
    setCreating(false);
    if (!r.ok) {
      setCreateError(r);
      return;
    }
    setNewName("");
    showToast(`"${name}" created.`, "check");
    await loadWorkspaces();
    selectWorkspace(r.workspaceId);
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email || !selectedId) return;
    setInviting(true);
    setInviteError(null);
    setLastInviteLink(null);
    const r = await inviteToWorkspace(selectedId, email, inviteRole);
    setInviting(false);
    if (!r.ok) {
      setInviteError(r);
      return;
    }
    setInviteEmail("");
    showToast(`Invited ${email}.`, "check");
    // The token only ever leaves the server once, in this response — GET
    // never returns it. Showing the link here is the only chance to hand it
    // to the person doing the inviting.
    if (r.token) {
      setLastInviteLink(`${window.location.origin}/workspace?invite=${encodeURIComponent(r.token)}`);
    }
    await loadDetail(selectedId);
  };

  const handleRemove = async (targetUserId, label) => {
    const isSelf = targetUserId === user?.id;
    if (!window.confirm(isSelf ? "Leave this workspace?" : `Remove ${label} from this workspace?`)) return;
    const r = await removeWorkspaceMember(selectedId, targetUserId);
    if (!r.ok) {
      showToast(r.error || "Couldn't do that.", "alert-circle");
      return;
    }
    showToast(isSelf ? "You left the workspace." : `${label} removed.`, "check");
    if (isSelf) {
      await loadWorkspaces();
      setSearchParams(new URLSearchParams(), { replace: true });
    } else {
      await loadDetail(selectedId);
    }
  };

  /**
   * Pause or resume one member's seat.
   *
   * NOT a removal, and the confirmation copy has to say so — "pause" next to
   * "remove" in a member list reads as a milder removal unless it is spelled
   * out. A paused member keeps read and export access, keeps their seat, and
   * keeps everything attributed to them.
   */
  const handlePause = async (targetUserId, label, paused) => {
    if (paused && !window.confirm(
      `Pause ${label}?\n\n` +
      "They will not be able to run extractions, enrichments or discoverability " +
      "audits. They keep read and export access, and their seat is still theirs.",
    )) return;
    const r = await setWorkspaceMemberPaused(selectedId, targetUserId, paused);
    if (!r.ok) { showToast(r.error || "Couldn't do that.", "alert-circle"); return; }
    showToast(paused ? `${label} paused.` : `${label} resumed.`, "check");
    await loadDetail(selectedId);
  };

  const handleRevoke = async (inviteId, email) => {
    const r = await revokeWorkspaceInvite(selectedId, inviteId);
    if (!r.ok) { showToast(r.error || "Couldn't revoke that invite.", "alert-circle"); return; }
    showToast(`Invite to ${email} revoked.`, "check");
    await loadDetail(selectedId);
  };

  const copyInviteLink = async () => {
    if (!lastInviteLink) return;
    try {
      await navigator.clipboard.writeText(lastInviteLink);
      showToast("Invite link copied.", "clipboard-copy");
    } catch {
      showToast("Couldn't copy — select and copy the link manually.", "alert-circle");
    }
  };

  if (loading) {
    return (
      <section className="ws-team-tab rise">
        <div className="ws-team-loading"><Icon name="loader" size={18} className="spin" /> Loading your workspaces…</div>
      </section>
    );
  }

  return (
    <section className="ws-team-tab rise">
      <header className="ws-team-head">
        <div>
          <span className="eyebrow">
            <Icon name="users" size={14} />
            Team
          </span>
          <h1 className="ws-team-title">Invite people into your work</h1>
          <p className="ws-team-sub">
            A workspace shares extractions, schedules and audits with the people you add to it.
          </p>
        </div>
      </header>

      {workspaces.length > 0 && (
        <div className="ws-team-switcher">
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              className={"ws-team-switch-btn" + (w.id === selectedId ? " ws-team-switch-active" : "")}
              onClick={() => selectWorkspace(w.id)}
            >
              {w.name}
              <span className="ws-team-seat-count">{w.seats} {w.seats === 1 ? "seat" : "seats"}</span>
            </button>
          ))}
        </div>
      )}

      {canCreate.allowed && (
        <form className="ws-team-create" onSubmit={handleCreate}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={workspaces.length === 0 ? "Name your workspace" : "Name a new workspace"}
            maxLength={120}
            aria-label="Workspace name"
          />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={creating || !newName.trim()}>
            {creating ? "Creating…" : "Create workspace"}
          </button>
          {workspaces.length > 0 && (
            <span className="ws-team-create-hint">{canCreate.remaining} of your plan's workspaces left</span>
          )}
        </form>
      )}
      {!canCreate.allowed && workspaces.length > 0 && (
        <p className="ws-team-cap-note">
          <Icon name="lock" size={12} /> You're using all the workspaces your plan includes.
        </p>
      )}
      {createError && (
        <p className="ws-team-error">
          {createError.error}
          {createError.upgradeTo && <a href="/pricing" className="ws-team-upgrade-link"> Upgrade</a>}
        </p>
      )}

      {workspaces.length === 0 && !canCreate.allowed && (
        <p className="ws-team-error">Your plan doesn't include a workspace to create yet.</p>
      )}

      {selected && (
        <div className="ws-team-detail">
          {detailLoading ? (
            <div className="ws-team-loading"><Icon name="loader" size={16} className="spin" /> Loading {selected.name}…</div>
          ) : (
            <>
              <div className="ws-team-members-card">
                <h2 className="ws-team-card-title">Members</h2>
                <ul className="ws-team-member-list">
                  {detail.members.map((m) => (
                    <li key={m.userId} className="ws-team-member-row">
                      <span className="ws-team-member-email">
                        {m.email || m.userId}
                        {m.userId === user?.id && <span className="ws-team-you"> (you)</span>}
                      </span>
                      <RoleBadge role={m.role} />
                      {/* A paused seat is stated, not implied by a greyed-out
                          row: the member is still here and still counted, and
                          somebody looking at the list needs to know why their
                          colleague's extractions are failing. */}
                      {m.pausedAt && <span className="ws-team-paused-badge">Paused</span>}
                      {/* Pause is available to owners/admins for anyone who is
                          not the owner, and to a member for themselves. The
                          OWNER can never be paused, by anybody including
                          themselves — an owner locked out of their own
                          workspace has no way back in. Enforced in SQL too. */}
                      {m.role !== "owner" &&
                       ((canManage && !(detail.myRole === "admin" && m.role === "admin" && m.userId !== user?.id))
                        || m.userId === user?.id) ? (
                        <button
                          type="button"
                          className="ws-team-pause-btn"
                          onClick={() => handlePause(m.userId, m.email || "this member", !m.pausedAt)}
                        >
                          {m.pausedAt ? "Resume" : "Pause"}
                        </button>
                      ) : null}
                      {(canManage && m.role !== "owner" && !(detail.myRole === "admin" && m.role === "admin")) ||
                      m.userId === user?.id ? (
                        <button
                          type="button"
                          className="ws-team-remove-btn"
                          onClick={() => handleRemove(m.userId, m.email || "this member")}
                        >
                          {m.userId === user?.id ? "Leave" : "Remove"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              {canManage && (
                <div className="ws-team-invite-card">
                  <h2 className="ws-team-card-title">Invite someone</h2>
                  <form className="ws-team-invite-form" onSubmit={handleInvite}>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="teammate@company.com"
                      aria-label="Email to invite"
                    />
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} aria-label="Role">
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={inviting || !inviteEmail.trim()}>
                      {inviting ? "Sending…" : "Send invite"}
                    </button>
                  </form>
                  {inviteError && (
                    <p className="ws-team-error">
                      {inviteError.error}
                      {inviteError.upgradeTo && <a href="/pricing" className="ws-team-upgrade-link"> Upgrade</a>}
                    </p>
                  )}
                  {lastInviteLink && (
                    <div className="ws-team-invite-link-box">
                      <span>Send this link — it only shows once:</span>
                      <div className="ws-team-invite-link-row">
                        <code>{lastInviteLink}</code>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={copyInviteLink}>
                          <Icon name="clipboard-copy" size={13} /> Copy
                        </button>
                      </div>
                    </div>
                  )}

                  {detail.invites.length > 0 && (
                    <>
                      <h3 className="ws-team-pending-title">Pending invites</h3>
                      <ul className="ws-team-invite-list">
                        {detail.invites.map((inv) => (
                          <li key={inv.id} className="ws-team-invite-row">
                            <span>{inv.email}</span>
                            <RoleBadge role={inv.role} />
                            <span className="ws-team-invite-meta">sent {timeAgo(inv.createdAt)}</span>
                            <button type="button" className="ws-team-remove-btn" onClick={() => handleRevoke(inv.id, inv.email)}>
                              Revoke
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
