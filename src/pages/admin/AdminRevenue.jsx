// AdminRevenue.jsx — revenue dashboard with KPIs and trend chart.
import { useMemo } from "react";
import { getRevenueMetrics, getRevenueTrend } from "../../lib/adminService.js";
import { PLAN_BY_ID } from "../../lib/pricingConfig.js";
import { useBilling } from "../../components/BillingProvider.jsx";
import { formatPrice, convertPrice } from "../../lib/currencyService.js";
import Icon from "../../components/Icon.jsx";

const PLAN_COLORS = { free: "#94a3b8", select: "#60a5fa", pro: "#818cf8", business: "#a78bfa", agency: "#f472b6" };

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
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const plan = PLAN_BY_ID[id];
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
  const metrics = useMemo(() => getRevenueMetrics(), []);
  const trend   = useMemo(() => getRevenueTrend(), []);

  const fmt = (usd) => formatPrice(convertPrice(usd, rates, currency), currency);

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <h2 className="admin-section-title">Revenue Dashboard</h2>
        <p className="admin-section-sub">Live metrics from subscriber data.</p>
      </div>

      <div className="admin-kpi-grid">
        <KpiCard label="Monthly Recurring Revenue" value={fmt(metrics.mrr)} icon="trending-up" accent="#818cf8" sub={`ARR ${fmt(metrics.arr)}`} />
        <KpiCard label="Total Users" value={metrics.totalUsers.toLocaleString()} icon="users" accent="#60a5fa" sub={`${metrics.freeUsers} free`} />
        <KpiCard label="Paying Subscribers" value={metrics.payingUsers.toLocaleString()} icon="zap" accent="#34d399" sub={`${Math.round((metrics.payingUsers / metrics.totalUsers) * 100)}% conversion`} />
        <KpiCard label="New This Month" value={metrics.newThisMonth.toLocaleString()} icon="plus" accent="#f472b6" />
        <KpiCard label="Coupon Uses" value={metrics.couponUsage.toLocaleString()} icon="bookmark" accent="#fb923c" />
      </div>

      <div className="admin-charts-row">
        <div className="card card-pad admin-chart-card">
          <div className="admin-chart-title">
            <Icon name="bar-chart" size={15} />
            MRR Trend (last 6 months)
          </div>
          <MiniBarChart data={trend} />
        </div>

        <div className="card card-pad admin-chart-card">
          <div className="admin-chart-title">
            <Icon name="layers" size={15} />
            Plan Distribution ({metrics.totalUsers} users)
          </div>
          <PlanDistribution byPlan={metrics.byPlan} total={metrics.totalUsers} />
        </div>
      </div>
    </div>
  );
}
