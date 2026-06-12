// AdminUsers.jsx — user management: invite, extend limits, track sources.
import { useState } from "react";
import { getAdminUsers, updateAdminUser, addAdminUser } from "../../lib/adminService.js";
import { getEffectivePlanById } from "../../lib/pricingOverrides.js";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const PLAN_COLORS = { free: "#94a3b8", select: "#60a5fa", pro: "#818cf8", business: "#a78bfa", agency: "#f472b6" };
const SOURCE_ICONS = { organic: "globe", referral: "share", linkedin: "linkedin", google: "search", "product-hunt": "zap", twitter: "twitter", direct: "arrow-right" };

function PlanPill({ planId }) {
  const plan = getEffectivePlanById(planId);
  return (
    <span className="user-plan-pill" style={{ "--pill-color": PLAN_COLORS[planId] ?? "#888" }}>
      {plan?.name ?? planId}
    </span>
  );
}

function ExtendModal({ user, onClose, onSave }) {
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
          <Button variant="primary" size="sm" onClick={() => onSave(user, bonus)}>Apply</Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function InviteModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: "", email: "", planId: "free", source: "invite" });
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
        <div className="modal-actions">
          <Button variant="primary" size="sm" icon="send"
            disabled={!form.name.trim() || !form.email.trim()}
            onClick={() => onSave(form)}>
            Send invite
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminUsers() {
  const [users, setUsers]         = useState(getAdminUsers);
  const [search, setSearch]       = useState("");
  const [extendUser, setExtend]   = useState(null);
  const [inviteOpen, setInvite]   = useState(false);
  const [planFilter, setPlan]     = useState("all");

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    const matchQ = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchP = planFilter === "all" || u.planId === planFilter;
    return matchQ && matchP;
  });

  const handleExtend = (user, bonus) => {
    const updated = { ...user, bonusExtractions: (user.bonusExtractions || 0) + bonus };
    setUsers(updateAdminUser(updated));
    setExtend(null);
  };

  const handleInvite = (form) => {
    setUsers(addAdminUser({ ...form, inviteSent: true }));
    setInvite(false);
  };

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2 className="admin-section-title">User Management</h2>
          <p className="admin-section-sub">{users.length} users — track sources, extend limits, send invites.</p>
        </div>
        <Button variant="primary" size="sm" icon="send" onClick={() => setInvite(true)}>
          Send invite
        </Button>
      </div>

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
                <tr><td colSpan={8} className="admin-empty">No users match your filters.</td></tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="user-row">
                    <td>
                      <div className="user-cell">
                        <div className="user-avatar">{u.name[0]}</div>
                        <div>
                          <div className="user-name">
                            {u.name}
                            {u.inviteSent && <span className="invite-badge">invited</span>}
                          </div>
                          <div className="user-email">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><PlanPill planId={u.planId} /></td>
                    <td>{u.extractionsThisMonth}</td>
                    <td>{u.bonusExtractions > 0 ? `+${u.bonusExtractions}` : "—"}</td>
                    <td>
                      <div className="source-cell">
                        <Icon name={SOURCE_ICONS[u.source] ?? "globe"} size={13} />
                        <span>{u.source}</span>
                      </div>
                    </td>
                    <td>{u.joinedAt}</td>
                    <td>{u.lastActive}</td>
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
      </div>

      {extendUser && <ExtendModal user={extendUser} onClose={() => setExtend(null)} onSave={handleExtend} />}
      {inviteOpen  && <InviteModal onClose={() => setInvite(false)} onSave={handleInvite} />}
    </div>
  );
}
