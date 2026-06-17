// AdminUsers.jsx — real user management via Supabase Auth admin API.
// Falls back to empty state (with a notice) when Supabase is not configured.
import { useState, useEffect, useCallback } from "react";
import { fetchRealUsers, extendUserBonus, inviteUserByEmail } from "../../lib/adminConfigService.js";
import { addAdminUser } from "../../lib/adminService.js";
import { getEffectivePlanById } from "../../lib/pricingOverrides.js";
import { useToast } from "../../components/Toast.jsx";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const PLAN_COLORS = {
  free: "#94a3b8", select: "#60a5fa", pro: "#818cf8",
  business: "#a78bfa", agency: "#f472b6",
};
const SOURCE_ICONS = {
  organic: "globe", referral: "share", linkedin: "linkedin",
  google: "search", "product-hunt": "zap", twitter: "twitter",
  direct: "arrow-right", github: "github", invite: "send",
};

function PlanPill({ planId }) {
  const plan = getEffectivePlanById(planId);
  return (
    <span className="user-plan-pill" style={{ "--pill-color": PLAN_COLORS[planId] ?? "#888" }}>
      {plan?.name ?? planId}
    </span>
  );
}

function ExtendModal({ user, onClose, onSave, saving }) {
  const [bonus, setBonus] = useState(100);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box card card-pad" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Extend usage for {user.name}</h3>
          <button className="modal-close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <p className="modal-sub">Add bonus extractions to this user's account.</p>
        <div className="cf-field">
          <label>Bonus extractions to add</label>
          <input type="number" min="1" max="10000" value={bonus}
            onChange={(e) => setBonus(Number(e.target.value))} />
        </div>
        <div className="modal-actions">
          <Button variant="primary" size="sm" disabled={saving} onClick={() => onSave(user, bonus)}>
            {saving ? "Saving…" : "Apply"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function InviteModal({ onClose, onSave, saving }) {
  const [form, setForm] = useState({ name: "", email: "", planId: "free", source: "invite" });
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    try { await onSave(form); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box card card-pad" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Send personalised invite</h3>
          <button className="modal-close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="cf-row">
          <div className="cf-field">
            <label>Name</label>
            <input type="text" placeholder="Jane Smith" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="cf-field">
            <label>Email</label>
            <input type="email" placeholder="jane@company.com" value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
        </div>
        <div className="cf-row">
          <div className="cf-field">
            <label>Starting plan</label>
            <select value={form.planId} onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value }))}>
              <option value="free">Free</option>
              <option value="select">Select</option>
              <option value="pro">Pro</option>
              <option value="business">Business</option>
              <option value="agency">Agency</option>
            </select>
          </div>
          <div className="cf-field">
            <label>Lead source</label>
            <select value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}>
              <option value="invite">Direct invite</option>
              <option value="organic">Organic</option>
              <option value="referral">Referral</option>
              <option value="linkedin">LinkedIn</option>
              <option value="google">Google</option>
              <option value="twitter">Twitter / X</option>
            </select>
          </div>
        </div>
        {err && <div className="admin-ai-notice warn" style={{ marginBottom: 0 }}>
          <Icon name="alert-circle" size={14} /><span>{err}</span>
        </div>}
        <div className="modal-actions">
          <Button variant="primary" size="sm" icon="send"
            disabled={saving || !form.name.trim() || !form.email.trim()}
            onClick={submit}>
            {saving ? "Sending…" : "Send invite"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminUsers() {
  const showToast = useToast();

  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [fromSeed, setFromSeed] = useState(false);
  const [warning, setWarning]   = useState("");

  const [search, setSearch]     = useState("");
  const [planFilter, setPlan]   = useState("all");

  const [extendUser, setExtend]   = useState(null);
  const [extSaving, setExtSaving] = useState(false);
  const [inviteOpen, setInvite]   = useState(false);
  const [invSaving, setInvSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchRealUsers();
      setUsers(result.users || []);
      setFromSeed(!!result.fromSeed);
      setWarning(result.warning || "");
    } catch (e) {
      setError(e.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    const matchQ = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchP = planFilter === "all" || u.planId === planFilter;
    return matchQ && matchP;
  });

  const handleExtend = async (user, bonus) => {
    setExtSaving(true);
    try {
      const result = await extendUserBonus(user.id, bonus);
      setUsers((prev) =>
        prev.map((u) => u.id === user.id ? { ...u, bonusExtractions: result.newBonus } : u)
      );
      showToast(`Added ${bonus} bonus extractions for ${user.name}.`);
      setExtend(null);
    } catch (e) {
      showToast(e.message || "Failed to extend usage.");
    } finally {
      setExtSaving(false);
    }
  };

  const handleInvite = async (form) => {
    setInvSaving(true);
    try {
      await inviteUserByEmail(form);
      // Also optimistically add to local list so the invite appears immediately.
      addAdminUser({ ...form, inviteSent: true });
      setUsers((prev) => [
        {
          id: `local-${Date.now()}`,
          name: form.name,
          email: form.email,
          planId: form.planId || "free",
          bonusExtractions: 0,
          source: form.source || "invite",
          joinedAt: new Date().toISOString().slice(0, 10),
          extractionsThisMonth: 0,
          lastActive: new Date().toISOString().slice(0, 10),
          inviteSent: true,
          confirmed: false,
        },
        ...prev,
      ]);
      showToast(`Invite sent to ${form.email}.`);
      setInvite(false);
    } catch (e) {
      if (e.localOnly) {
        // Supabase not configured — fall back to local-only record
        addAdminUser({ ...form, inviteSent: true });
        showToast("Invite recorded locally (Supabase not configured).");
        setInvite(false);
      } else {
        throw e; // re-throw so InviteModal can display the error
      }
    } finally {
      setInvSaving(false);
    }
  };

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2 className="admin-section-title">User Management</h2>
          <p className="admin-section-sub">
            {loading ? "Loading…" : `${users.length} registered user${users.length !== 1 ? "s" : ""}`}
            {!loading && " — track sign-ups, extend limits, send invites."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" size="sm" icon="refresh" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button variant="primary" size="sm" icon="send" onClick={() => setInvite(true)}>
            Send invite
          </Button>
        </div>
      </div>

      {/* Supabase-not-configured notice */}
      {(fromSeed || warning) && !loading && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-triangle" size={15} />
          <span>
            {warning || "Supabase not configured — add SUPABASE_URL + SUPABASE_SERVICE_KEY to Netlify env to see real users."}
          </span>
        </div>
      )}

      {error && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-circle" size={15} /><span>{error}</span>
        </div>
      )}

      <div className="admin-filters card card-pad">
        <div className="field-shell admin-search-field">
          <div className="field-lead"><Icon name="search" size={16} /></div>
          <input className="field-input" placeholder="Search by name or email…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="admin-plan-filter" value={planFilter} onChange={(e) => setPlan(e.target.value)}>
          <option value="all">All plans</option>
          <option value="free">Free</option>
          <option value="select">Select</option>
          <option value="pro">Pro</option>
          <option value="business">Business</option>
          <option value="agency">Agency</option>
        </select>
      </div>

      <div className="card admin-table-card">
        {loading ? (
          <div className="admin-ai-loading">
            <Icon name="loader" size={18} className="spin" /> Loading users from Supabase…
          </div>
        ) : (
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Plan</th>
                  <th>Extractions (mo)</th>
                  <th>Bonus</th>
                  <th>Source</th>
                  <th>Joined</th>
                  <th>Last active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="admin-empty">
                      {users.length === 0
                        ? fromSeed
                          ? "No users yet — Supabase not configured or no sign-ups."
                          : "No registered users yet."
                        : "No users match your filters."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u.id} className="user-row">
                      <td>
                        <div className="user-cell">
                          <div className="user-avatar">{(u.name || u.email || "?")[0].toUpperCase()}</div>
                          <div>
                            <div className="user-name">
                              {u.name}
                              {u.inviteSent && !u.confirmed && (
                                <span className="invite-badge">pending</span>
                              )}
                            </div>
                            <div className="user-email">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td><PlanPill planId={u.planId} /></td>
                      <td>{u.extractionsThisMonth || "—"}</td>
                      <td>{u.bonusExtractions > 0 ? `+${u.bonusExtractions}` : "—"}</td>
                      <td>
                        <div className="source-cell">
                          <Icon name={SOURCE_ICONS[u.source] ?? "globe"} size={13} />
                          <span>{u.source || "—"}</span>
                        </div>
                      </td>
                      <td>{u.joinedAt || "—"}</td>
                      <td>{u.lastActive || "—"}</td>
                      <td>
                        <button className="icon-action" title="Extend usage" onClick={() => setExtend(u)}>
                          <Icon name="zap" size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {extendUser && (
        <ExtendModal
          user={extendUser}
          saving={extSaving}
          onClose={() => setExtend(null)}
          onSave={handleExtend}
        />
      )}
      {inviteOpen && (
        <InviteModal
          saving={invSaving}
          onClose={() => setInvite(false)}
          onSave={handleInvite}
        />
      )}
    </div>
  );
}
