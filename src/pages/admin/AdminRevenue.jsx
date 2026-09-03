// AdminRevenue.jsx — revenue dashboard loaded from live Supabase data.
import { useState, useEffect, useCallback, useRef } from "react";
import { getRevenueData } from "../../lib/adminConfigService.js";
import PqlFunnel from "./PqlFunnel.jsx";
import { getEffectivePlanById } from "../../lib/pricingOverrides.js";
import { useBilling } from "../../components/BillingProvider.jsx";
import { formatPrice, convertPrice } from "../../lib/currencyService.js";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const PLAN_COLORS = {
  free: "#94a3b8", select: "#60a5fa", pro: "#818cf8",
  business: "#a78bfa", agency: "#f472b6",
};

function KpiCard({ label, value, sub, icon, accent }) {
  return (
    <div className="admin-kpi-card card card-pad">
      <div className="kpi-icon" style={{ "--kpi-accent": accent ?? "var(--accent)" }}>
        <Icon name={icon} size={18} />
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function MiniBarChart({ data }) {
  const max = Math.max(...data.map((d) => d.mrr), 1);
  return (
    <div className="mini-bar-chart">
      {data.map((d) => (
        <div key={d.label} className="mini-bar-col">
          <div className="mini-bar-wrap">
            <div className="mini-bar-fill" style={{ height: `${Math.round((d.mrr / max) * 100)}%` }} />
          </div>
          <div className="mini-bar-label">{d.label}</div>
          <div className="mini-bar-val">${d.mrr.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

function PlanDistribution({ byPlan, total }) {
  return (
    <div className="plan-dist">
      {Object.entries(byPlan).map(([id, count]) => {
        const pct  = total > 0 ? Math.round((count / total) * 100) : 0;
        const plan = getEffectivePlanById(id);
        return (
          <div key={id} className="pd-row">
            <div className="pd-label" style={{ "--dot": PLAN_COLORS[id] ?? "#888" }}>
              <span className="pd-dot" />
              <span>{plan?.name ?? id}</span>
            </div>
            <div className="pd-bar-wrap">
              <div className="pd-bar-fill" style={{ width: `${pct}%`, background: PLAN_COLORS[id] ?? "var(--accent)" }} />
            </div>
            <div className="pd-count">{count} ({pct}%)</div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminRevenue() {
  const { currency, rates } = useBilling();

  const [metrics, setMetrics] = useState(null);
  const [trend,   setTrend]   = useState(null);
  // `null` funnel and `funnelAvailable:false` are DIFFERENT states — see
  // PqlFunnel. Kept as two values rather than collapsed into one truthiness
  // check, because "table unreadable" must not render as "nobody activated".
  const [funnel, setFunnel] = useState(null);
  const [funnelAvailable, setFunnelAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");
  const [warning, setWarning] = useState("");
  const [fromSeed, setFromSeed] = useState(false);

  // Guards every setState below. `load` is also called by the Refresh button,
  // so this has to be a ref rather than an effect-scoped flag: a fetch started
  // by a click can still be in flight when the component unmounts. Without it
  // a late resolve calls setState on a dead tree — a no-op warning in the app,
  // but an unhandled "window is not defined" (and a red suite) under vitest,
  // where the jsdom environment is torn down the moment the file finishes.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getRevenueData();
      if (!alive.current) return;
      setMetrics(data.metrics);
      setTrend(data.trend);
      setFunnel(data.funnel ?? null);
      // Absent field (an older deploy of the function) is treated as available
      // so the panel simply renders nothing, rather than accusing the operator
      // of a missing migration that may be perfectly well applied.
      setFunnelAvailable(data.funnelAvailable !== false);
      setFromSeed(!!data.fromSeed);
      setWarning(data.warning || "");
    } catch (e) {
      if (!alive.current) return;
      setError(e.message || "Failed to load revenue data.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = (usd) => formatPrice(convertPrice(usd, rates, currency), currency);

  if (loading) {
    return (
      <div className="admin-section">
        <div className="admin-section-head">
          <h2 className="admin-section-title">Revenue Dashboard</h2>
        </div>
        <div className="admin-ai-loading" style={{ padding: "32px 0" }}>
          <Icon name="loader" size={18} className="spin" /> Loading revenue data from Supabase…
        </div>
      </div>
    );
  }

  const m = metrics || { mrr: 0, arr: 0, totalUsers: 0, payingUsers: 0, freeUsers: 0, byPlan: {}, newThisMonth: 0, couponUsage: 0 };
  const t = trend || [];
  const conversion = m.totalUsers > 0 ? Math.round((m.payingUsers / m.totalUsers) * 100) : 0;

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2 className="admin-section-title">Revenue Dashboard</h2>
          <p className="admin-section-sub">Live metrics from Supabase subscriber data.</p>
        </div>
        <Button variant="ghost" size="sm" icon="refresh" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {(fromSeed || warning) && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-triangle" size={15} />
          <span>
            {warning || "Supabase not configured — add SUPABASE_URL + SUPABASE_SERVICE_KEY to Netlify env to see live revenue."}
          </span>
        </div>
      )}

      {error && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-circle" size={15} /><span>{error}</span>
        </div>
      )}

      <PqlFunnel funnel={funnel} available={funnelAvailable} />

      <div className="admin-kpi-grid">
        <KpiCard
          label="Monthly Recurring Revenue"
          value={fmt(m.mrr)}
          icon="trending-up"
          accent="#818cf8"
          sub={`ARR ${fmt(m.arr)}`}
        />
        <KpiCard
          label="Total Users"
          value={m.totalUsers.toLocaleString()}
          icon="users"
          accent="#60a5fa"
          sub={`${m.freeUsers} free`}
        />
        <KpiCard
          label="Paying Subscribers"
          value={m.payingUsers.toLocaleString()}
          icon="zap"
          accent="#34d399"
          sub={`${conversion}% conversion`}
        />
        <KpiCard
          label="New This Month"
          value={m.newThisMonth.toLocaleString()}
          icon="plus"
          accent="#f472b6"
        />
        <KpiCard
          label="Coupon Redemptions"
          value={m.couponUsage.toLocaleString()}
          icon="tag"
          accent="#fb923c"
        />
      </div>

      <div className="admin-charts-row">
        <div className="card card-pad admin-chart-card">
          <div className="admin-chart-title">
            <Icon name="bar-chart" size={15} />
            Revenue collected (last 6 months)
          </div>
          {t.length > 0
            ? <MiniBarChart data={t} />
            : <p className="admin-empty" style={{ padding: "24px 0" }}>No payment events found.</p>}
        </div>

        <div className="card card-pad admin-chart-card">
          <div className="admin-chart-title">
            <Icon name="layers" size={15} />
            Plan Distribution ({m.totalUsers} users)
          </div>
          {Object.keys(m.byPlan).length > 0
            ? <PlanDistribution byPlan={m.byPlan} total={m.totalUsers} />
            : <p className="admin-empty" style={{ padding: "24px 0" }}>No subscription data found.</p>}
        </div>
      </div>
    </div>
  );
}
