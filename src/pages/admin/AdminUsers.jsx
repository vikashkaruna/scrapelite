// AdminUsers.jsx — real user management via Supabase Auth admin API.
// Falls back to empty state (with a notice) when Supabase is not configured.
import { useState, useEffect, useCallback } from "react";
import {
  fetchRealUsers, extendUserBonus, inviteUserByEmail, assignAdminGrantCoupon,
} from "../../lib/adminConfigService.js";
import { addAdminUser } from "../../lib/adminService.js";
import { getEffectivePlanById, getEffectivePlans } from "../../lib/pricingOverrides.js";
import { useToast } from "../../components/Toast.jsx";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const PLAN_COLORS = {
  free: "#94a3b8", go: "#38bdf8", select: "#60a5fa", pro: "#818cf8",
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

function PlanPeriod({ start, end }) {
  if (!start && !end) return <span className="user-period-none">—</span>;
  return (
    <div className="user-period-cell">
      {start && <span className="user-period-date">{start}</span>}
      {start && end && <span className="user-period-sep">→</span>}
      {end && <span className="user-period-date user-period-end">{end}</span>}
    </div>
  );
}

function CouponPill({ code, discount, planId }) {
  if (!code) return <span className="user-period-none">—</span>;
  const plan = planId ? getEffectivePlanById(planId) : null;
  return (
    <span className="user-coupon-pill" title={plan ? `Restricted to ${plan.name}` : "Valid for any plan"}>
      {code}
      {discount != null && discount > 0 && (
        <span className="user-coupon-pct"> −{discount}%</span>
      )}
      {plan && <span className="user-coupon-plan"> · {plan.name}</span>}
    </span>
  );
}

function GrantPill({ grant }) {
  if (!grant) return <span className="user-period-none">—</span>;
  const plan = getEffectivePlanById(grant.planId);
  return (
    <span className="user-coupon-pill" title={`${plan?.name || grant.planId}, ${grant.validityMonths} month grant`}>
      {grant.code} · {plan?.name || grant.planId}
      <span className="user-coupon-plan"> · {grant.status}</span>
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

function CouponModal({ user, onClose, onSave, saving }) {
  const plans = getEffectivePlans().filter((p) => !p.comingSoon && p.price_usd > 0);
  const [code, setCode] = useState("");
  const [planId, setPlanId] = useState(plans[0]?.id || "pro");
  const [validityMonths, setValidityMonths] = useState(1);
  const [claimExpiresAt, setClaimExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!code.trim()) { setErr("Enter a one-time grant code."); return; }
    if (!reason.trim()) { setErr("A reason is required for the audit trail."); return; }
    try { await onSave(user, { couponCode: code, planId, validityMonths: Number(validityMonths), claimExpiresAt, reason }); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box card card-pad" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Assign coupon — {user.name}</h3>
          <button className="modal-close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <p className="modal-sub">
          Issue a one-time complimentary plan grant. The user must apply the code
          from their own Account page; this does not alter paid checkout.
        </p>

        <div className="cf-field">
          <label>One-time grant code</label>
          <input type="text" placeholder="e.g. ALICE-PRO-1M" value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={24} />
        </div>

        <div className="cf-row">
          <div className="cf-field">
            <label>Plan granted</label>
            <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="cf-field">
            <label>Validity</label>
            <select value={validityMonths} onChange={(e) => setValidityMonths(Number(e.target.value))}>
              {[1, 2, 3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} month{m === 1 ? "" : "s"}</option>)}
            </select>
          </div>
        </div>
        <div className="cf-row">
          <div className="cf-field">
            <label>Claim by (optional)</label>
            <input type="date" value={claimExpiresAt} onChange={(e) => setClaimExpiresAt(e.target.value)} />
          </div>
          <div className="cf-field">
            <label>Reason</label>
            <input type="text" placeholder="Customer goodwill" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>

        {err && (
          <div className="admin-ai-notice warn" style={{ marginBottom: 0 }}>
            <Icon name="alert-circle" size={14} /><span>{err}</span>
          </div>
        )}
        <div className="modal-actions">
          <Button variant="primary" size="sm" icon="tag" disabled={saving || !code || !reason} onClick={submit}>
            {saving ? "Assigning…" : "Assign grant coupon"}
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
              <option value="go">Go</option>
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

  const [extendUser, setExtend]     = useState(null);
  const [extSaving, setExtSaving]   = useState(false);
  const [couponUser, setCoupon]     = useState(null);
  const [couponSaving, setCouponSaving] = useState(false);
  const [inviteOpen, setInvite]     = useState(false);
  const [invSaving, setInvSaving]   = useState(false);

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

  const handleAssignCoupon = async (user, grant) => {
    setCouponSaving(true);
    try {
      const result = await assignAdminGrantCoupon(user.id, { ...grant, userEmail: user.email });
      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id
            ? { ...u, adminGrantCoupon: result.adminGrantCoupon }
            : u
        )
      );
      const planLabel = getEffectivePlanById(grant.planId)?.name || grant.planId;
      showToast(`Grant ${result.adminGrantCoupon.code} assigned to ${user.name} (${planLabel}, ${grant.validityMonths} month${grant.validityMonths === 1 ? "" : "s"}).`);
      setCoupon(null);
    } catch (e) {
      throw e; // re-throw so CouponModal displays the error inline
    } finally {
      setCouponSaving(false);
    }
  };

  const handleInvite = async (form) => {
    setInvSaving(true);
    try {
      await inviteUserByEmail(form);
      addAdminUser({ ...form, inviteSent: true });
      setUsers((prev) => [
        {
          id: `local-${Date.now()}`,
          name: form.name,
          email: form.email,
          planId: form.planId || "free",
          planStart: null,
          planEnd: null,
          couponAvailed: null,
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
        addAdminUser({ ...form, inviteSent: true });
        showToast("Invite recorded locally (Supabase not configured).");
        setInvite(false);
      } else {
        throw e;
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
            {!loading && " — track sign-ups, extend limits, issue plan grants, send invites."}
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
          <option value="go">Go</option>
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
                  <th>Plan grant</th>
                  <th>Plan period</th>
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
                    <td colSpan={10} className="admin-empty">
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
                      <td><GrantPill grant={u.adminGrantCoupon} /></td>
                      <td><PlanPeriod start={u.planStart} end={u.planEnd} /></td>
                      <td className="user-extractions">
                        {u.extractionsThisMonth > 0
                          ? u.extractionsThisMonth
                          : <span className="user-period-none">0</span>}
                      </td>
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
                        <div className="user-actions-cell">
                          <button className="icon-action" title="Extend usage" onClick={() => setExtend(u)}>
                            <Icon name="zap" size={14} />
                          </button>
                          <button className="icon-action" title="Assign coupon" onClick={() => setCoupon(u)}>
                            <Icon name="tag" size={14} />
                          </button>
                        </div>
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
      {couponUser && (
        <CouponModal
          user={couponUser}
          saving={couponSaving}
          onClose={() => setCoupon(null)}
          onSave={handleAssignCoupon}
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
