// AdminLayout.jsx — admin shell with PIN gate + collapsible sidebar navigation.
import { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  isAdminAuthed, adminLogin, adminLogout,
  getAdminLock, recordAdminFailure, clearAdminFailures, ADMIN_MAX_ATTEMPTS,
} from "../../lib/adminService.js";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const NAV = [
  { to: "/admin/revenue", label: "Revenue",  icon: "bar-chart" },
  { to: "/admin/pricing", label: "Pricing",  icon: "dollar-sign" },
  { to: "/admin/coupons", label: "Coupons",  icon: "bookmark" },
  { to: "/admin/users",   label: "Users",    icon: "users" },
  { to: "/admin/ai",      label: "AI",       icon: "sparkles" },
];

const LS_COL = "datiq.adminSidebarCollapsed";
const LS_PIN = "datiq.adminSidebarPinned";

function PinGate({ onAuthed }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lock, setLock] = useState(() => getAdminLock());

  // While locked, tick once a second to update the countdown and auto-unlock.
  useEffect(() => {
    if (!lock.locked) return;
    const id = setInterval(() => {
      const l = getAdminLock();
      setLock(l);
      if (!l.locked) setError("");
    }, 1000);
    return () => clearInterval(id);
  }, [lock.locked]);

  const submit = async (e) => {
    e.preventDefault();
    if (getAdminLock().locked) return;
    setLoading(true);
    const res = await adminLogin(pin);
    setLoading(false);
    if (res.ok) { clearAdminFailures(); onAuthed(); return; }
    setPin("");
    const after = recordAdminFailure();
    if (after.locked) {
      setLock(getAdminLock());
      setError("Too many attempts — locked for 60 seconds.");
    } else {
      const left = ADMIN_MAX_ATTEMPTS - after.attempts;
      setError(`Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left.`);
    }
  };

  const secsLeft = lock.locked ? Math.max(0, Math.ceil((lock.until - Date.now()) / 1000)) : 0;
  const disabled = loading || lock.locked || !pin.trim();

  return (
    <div className="page admin-gate-page">
      <div className="admin-gate-card card card-pad">
        <div className="admin-gate-icon">
          <Icon name="shield" size={28} />
        </div>
        <h2 className="admin-gate-title">Admin Access</h2>
        <p className="admin-gate-sub">Enter your admin PIN to continue.</p>
        <form className="admin-gate-form" onSubmit={submit}>
          <input
            type="password"
            className="admin-pin-input"
            placeholder="Admin PIN"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(""); }}
            autoComplete="current-password"
            maxLength={64}
            disabled={lock.locked}
          />
          {error && <div className="admin-gate-error">{error}</div>}
          <Button variant="primary" type="submit" disabled={disabled} fullWidth>
            {lock.locked ? `Locked — ${secsLeft}s` : loading ? "Verifying…" : "Enter Admin"}
          </Button>
        </form>
        <p className="admin-gate-hint">PIN is verified securely on the server.</p>
      </div>
    </div>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [authed, setAuthed] = useState(isAdminAuthed);

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(LS_COL) === "1");
  const [pinned, setPinned] = useState(() => localStorage.getItem(LS_PIN) !== "0");
  const [hovered, setHovered] = useState(false);

  // Sidebar is visually expanded when: not collapsed, OR (collapsed but not pinned and hovered)
  const isExpanded = !collapsed || (!pinned && hovered);

  useEffect(() => {
    if (authed && pathname === "/admin") navigate("/admin/revenue", { replace: true });
  }, [authed, pathname]);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(LS_COL, next ? "1" : "0");
  };

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    localStorage.setItem(LS_PIN, next ? "1" : "0");
  };

  if (!authed) return <PinGate onAuthed={() => setAuthed(true)} />;

  return (
    <div className={"admin-layout" + (isExpanded ? "" : " sidebar-collapsed")}>
      <aside
        className={"admin-sidebar" + (isExpanded ? "" : " collapsed")}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="admin-sidebar-head">
          <div className="admin-brand-mark">
            <Icon name="shield" size={17} />
          </div>
          {isExpanded && <span className="admin-brand-label">Admin</span>}
          <div className="admin-sidebar-ctrls">
            {isExpanded && (
              <button
                className={"admin-ctrl-btn" + (pinned ? " pinned" : "")}
                onClick={togglePin}
                title={pinned ? "Unpin sidebar (auto-collapse on hover out)" : "Pin sidebar open"}
              >
                <Icon name={pinned ? "pin" : "pin-off"} size={14} />
              </button>
            )}
            <button
              className="admin-ctrl-btn"
              onClick={toggleCollapse}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={14} />
            </button>
          </div>
        </div>
        <nav className="admin-nav">
          {NAV.map((n) => (
            <div
              key={n.to}
              className={"admin-nav-item" + (pathname.startsWith(n.to) ? " active" : "") + (isExpanded ? "" : " icon-only")}
              onClick={() => navigate(n.to)}
              title={isExpanded ? undefined : n.label}
            >
              <Icon name={n.icon} size={17} />
              {isExpanded && <span>{n.label}</span>}
            </div>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <button
            className={"admin-logout" + (isExpanded ? "" : " icon-only")}
            onClick={() => { adminLogout(); setAuthed(false); navigate("/"); }}
            title={isExpanded ? undefined : "Exit admin"}
          >
            <Icon name="x" size={15} />
            {isExpanded && <span>Exit admin</span>}
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
